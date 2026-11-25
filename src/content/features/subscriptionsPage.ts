import type { Settings } from '../../types/settings'
import { clearInjectedCSS, setInjectedCSS, waitForElement } from '../lib/dom'
import { getYouTubePageType } from '../lib/youtubeNav'
import { wrappingMetadataCSS } from '../lib/gridMetadata'

// YouTube's SPA keeps the previously-visited feed's ytd-browse mounted but hidden, so scope to the live one
const SUBSCRIPTIONS_BROWSE_SELECTOR = 'ytd-browse[page-subtype="subscriptions"]:not([hidden])'
const GRID_CONTENTS_SELECTOR = `${SUBSCRIPTIONS_BROWSE_SELECTOR} ytd-rich-grid-renderer #contents`
const VIDEO_ITEM_SELECTOR = `${SUBSCRIPTIONS_BROWSE_SELECTOR} ytd-rich-item-renderer`
// The lockup's title link; its text is the bare title, without the duration that its aria-label appends
const VIDEO_TITLE_SELECTOR = '.ytLockupMetadataViewModelTitle'
// The red bar along the thumbnail's bottom edge; only present once watched, its inline width is the percentage
const WATCHED_PROGRESS_SELECTOR = '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment'
const MATCHED_VIDEO_CLASS = 'ytimprover-hidden-video'
const MATCHED_VIDEO_SELECTOR = `${VIDEO_ITEM_SELECTOR}.${MATCHED_VIDEO_CLASS}`
const HIDE_REASON_ATTR = 'data-ytimprover-hide-reason'
const REVEAL_BUTTON_ID = 'ytimprover-reveal-hidden-videos'
const SHORTS_SHELF_CSS_ID = 'subscriptions-hide-shorts'
const GRID_COLUMNS_CSS_ID = 'subscriptions-grid-columns'
const MATCHED_VIDEOS_CSS_ID = 'subscriptions-hide-matched-videos'

// Sits just above #contents. The grid renderer is a centering flex column, hence align-self; the side margin is
// #contents' 16px plus a card's own 8px, so it lines up with the first card (live-checked), and #contents' 24px
// top padding spaces it from the grid. The theme vars are YouTube's chip fills, from the live page.
const REVEAL_BUTTON_CSS = `#${REVEAL_BUTTON_ID} {
  display: block;
  align-self: flex-start;
  margin: 24px 24px 0;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  color: var(--yt-sys-color-baseline--text-primary, inherit);
  background: var(--yt-sys-color-baseline--additive-background, rgba(128, 128, 128, 0.15));
}
#${REVEAL_BUTTON_ID}:hover {
  background: var(--yt-sys-color-baseline--button-chip-background-hover, rgba(128, 128, 128, 0.25));
}`

// #contents is a flat flex row, so a hidden item just lets the rest reflow - no gap is left behind
const HIDDEN_VIDEOS_CSS = `${REVEAL_BUTTON_CSS}
${MATCHED_VIDEO_SELECTOR} { display: none !important; }`

// Revealed cards are dimmed in place with a label saying why they were hidden. The label hangs off the card
// (already position: relative) rather than #content, so the dimming doesn't fade it too. Hover restores the
// card and drops the label, which would otherwise sit on top of YouTube's inline preview.
const REVEALED_VIDEOS_CSS = `${REVEAL_BUTTON_CSS}
${MATCHED_VIDEO_SELECTOR} > #content { opacity: 0.4; transition: opacity 0.15s; }
${MATCHED_VIDEO_SELECTOR}:hover > #content { opacity: 1; }
${MATCHED_VIDEO_SELECTOR}::before {
  content: attr(${HIDE_REASON_ATTR});
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 1;
  padding: 3px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  pointer-events: none;
  transition: opacity 0.15s;
}
${MATCHED_VIDEO_SELECTOR}:hover::before { opacity: 0; }`

export function applySubscriptionsPage(settings: Settings['subscriptionsPage']): void {
  const isSubscriptionsPage = getYouTubePageType() === 'subscriptions'

  if (!settings.enabled || !isSubscriptionsPage) {
    clearInjectedCSS(SHORTS_SHELF_CSS_ID)
    clearInjectedCSS(GRID_COLUMNS_CSS_ID)
    stopHidingVideos()
    return
  }

  applyHideShorts(settings.hideShorts)
  applyVideosPerRow(settings.videosPerRow)
  applyHideVideos(settings)
}

interface VideoFilter {
  /** Lowercased title substrings */
  needles: string[]
  /** null = don't filter on watch progress */
  minWatchedPercent: number | null
}

let videoObserver: MutationObserver | null = null
/** Replaced (never mutated) on every apply, so an in-flight watcher can tell it was superseded. */
let activeFilter: VideoFilter | null = null
let scanQueued = false
let feedContainer: HTMLElement | null = null
let revealButton: HTMLButtonElement | null = null
/** Session-only: leaving the page puts the videos back into hiding. */
let revealHidden = false

function applyHideVideos(settings: Settings['subscriptionsPage']): void {
  const needles = settings.hideVideosContaining.map((keyword) => keyword.toLowerCase())
  const minWatchedPercent = settings.hideWatched ? settings.hideWatchedPercent : null
  if (needles.length === 0 && minWatchedPercent === null) {
    stopHidingVideos()
    return
  }
  activeFilter = { needles, minWatchedPercent }
  setInjectedCSS(MATCHED_VIDEOS_CSS_ID, revealHidden ? REVEALED_VIDEOS_CSS : HIDDEN_VIDEOS_CSS)
  void watchFeed(activeFilter)
}

function stopHidingVideos(): void {
  activeFilter = null
  revealHidden = false
  clearInjectedCSS(MATCHED_VIDEOS_CSS_ID)
  videoObserver?.disconnect()
  videoObserver = null
  feedContainer = null
  revealButton?.remove()
  document.querySelectorAll(`.${MATCHED_VIDEO_CLASS}`).forEach((el) => {
    el.classList.remove(MATCHED_VIDEO_CLASS)
    el.removeAttribute(HIDE_REASON_ATTR)
  })
}

function toggleReveal(): void {
  revealHidden = !revealHidden
  setInjectedCSS(MATCHED_VIDEOS_CSS_ID, revealHidden ? REVEALED_VIDEOS_CSS : HIDDEN_VIDEOS_CSS)
  scanVideos() // relabels the button
}

function updateRevealButton(hiddenCount: number): void {
  if (!feedContainer || hiddenCount === 0) {
    revealButton?.remove()
    return
  }
  if (!revealButton) {
    revealButton = document.createElement('button')
    revealButton.type = 'button'
    revealButton.id = REVEAL_BUTTON_ID
    revealButton.addEventListener('click', toggleReveal)
  }
  // Outside #contents on purpose: relabelling it must not wake the observer that triggered this scan.
  // Re-placed every pass because YouTube can re-stamp the grid's children and drop it.
  if (revealButton.nextElementSibling !== feedContainer) feedContainer.before(revealButton)
  const label = revealHidden ? `Hide videos again (${hiddenCount} hidden)` : `Show hidden videos (${hiddenCount} hidden)`
  if (revealButton.textContent !== label) revealButton.textContent = label
  revealButton.setAttribute('aria-expanded', String(revealHidden))
}

/** 0 when there is no bar, i.e. never watched (or watch history is off). */
function watchedPercent(item: Element): number {
  const width = item.querySelector<HTMLElement>(WATCHED_PROGRESS_SELECTOR)?.style.width ?? ''
  return width.endsWith('%') ? parseFloat(width) : 0
}

/** Why the video should be hidden, as shown on its revealed card, or null to leave it alone. */
function hideReason(item: Element, filter: VideoFilter): string | null {
  if (filter.minWatchedPercent !== null) {
    // The > 0 keeps a bar-less (unwatched) video visible even if a bad stored threshold ever reaches 0
    const watched = watchedPercent(item)
    if (watched > 0 && watched >= filter.minWatchedPercent) return `Watched ${Math.round(watched)}%`
  }
  if (filter.needles.length === 0) return null
  const title = item.querySelector(VIDEO_TITLE_SELECTOR)?.textContent?.trim().toLowerCase() ?? ''
  if (title.length === 0) return null
  const needle = filter.needles.find((candidate) => title.includes(candidate))
  return needle === undefined ? null : `Title contains "${needle}"`
}

function scanVideos(): void {
  scanQueued = false
  const filter = activeFilter
  let hiddenCount = 0
  document.querySelectorAll(VIDEO_ITEM_SELECTOR).forEach((item) => {
    const reason = filter ? hideReason(item, filter) : null
    item.classList.toggle(MATCHED_VIDEO_CLASS, reason !== null)
    if (reason === null) {
      item.removeAttribute(HIDE_REASON_ATTR)
    } else {
      hiddenCount += 1
      if (item.getAttribute(HIDE_REASON_ATTR) !== reason) item.setAttribute(HIDE_REASON_ATTR, reason)
    }
  })
  updateRevealButton(hiddenCount)
}

// The feed churns (infinite scroll, lazy-rendered metadata), and a full rescan per mutation record adds up over
// hundreds of items - so collapse a burst into one scan, which still lands before the next paint
function queueScan(): void {
  if (scanQueued) return
  scanQueued = true
  requestAnimationFrame(scanVideos)
}

async function watchFeed(filter: VideoFilter): Promise<void> {
  const container = await waitForElement<HTMLElement>(GRID_CONTENTS_SELECTOR)
  // A later apply (new settings, or navigating away) took over while this one waited
  if (!container || activeFilter !== filter) return
  feedContainer = container
  scanVideos()
  videoObserver?.disconnect()
  videoObserver = new MutationObserver(queueScan)
  // characterData: YouTube can reuse an item element for a different video and only swap its text.
  // style: the progress bar can grow in place (its width is inline). Our own markers are a class and a data
  // attribute, both outside the filter, so marking an item doesn't trigger another scan.
  videoObserver.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style'],
  })
}

function applyHideShorts(hideShorts: boolean): void {
  if (!hideShorts) {
    clearInjectedCSS(SHORTS_SHELF_CSS_ID)
    return
  }
  setInjectedCSS(
    SHORTS_SHELF_CSS_ID,
    `${SUBSCRIPTIONS_BROWSE_SELECTOR} ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
${SUBSCRIPTIONS_BROWSE_SELECTOR} ytd-rich-shelf-renderer[is-shorts],
${SUBSCRIPTIONS_BROWSE_SELECTOR} ytd-reel-shelf-renderer {
  display: none !important;
}`
  )
}

function applyVideosPerRow(videosPerRow: number | null): void {
  if (videosPerRow == null) {
    clearInjectedCSS(GRID_COLUMNS_CSS_ID)
    return
  }
  const columns = Math.max(1, Math.floor(videosPerRow))
  // YouTube sizes each item as width: calc(100%/var(--ytd-rich-grid-items-per-row) - item-margin) inside a
  // flex row, and sets that var inline per viewport - so !important is required to win. Overriding the var
  // (rather than forcing display:grid) is what keeps full-width shelf rows from collapsing into one column.
  setInjectedCSS(
    GRID_COLUMNS_CSS_ID,
    `${SUBSCRIPTIONS_BROWSE_SELECTOR} ytd-rich-grid-renderer { --ytd-rich-grid-items-per-row: ${columns} !important; }
${wrappingMetadataCSS(SUBSCRIPTIONS_BROWSE_SELECTOR)}`
  )
}
