import type { QualityLevel, Settings } from '../../types/settings'
import { setInjectedCSS, clearInjectedCSS } from '../lib/dom'
import { sendPlayerCommand } from '../bridge/playerBridge'
import { getYouTubePageType } from '../lib/youtubeNav'

/**
 * The two places Shorts shelves appear are hidden by separate settings.
 *
 * These used to be one unscoped rule, so hiding Shorts "in feeds" also stripped the Shorts row from a
 * watch page's related column - a reasonable thing to want, but not something a switch labelled
 * "in feeds" should decide for you.
 *
 * `ytd-rich-shelf-renderer[is-shorts]` is the grid-feed shape (Home, Subscriptions) and
 * `ytd-reel-shelf-renderer` is the list shape (search results, the watch sidebar). Both are matched in
 * the feed scope because which one YouTube uses varies by surface.
 */
const SHORTS_SHELVES = 'ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer'

const HIDE_FEEDS_STYLE_ID = 'shorts-hide-feeds'
const FEED_SCOPES = ['ytd-browse', 'ytd-search']
const HIDE_FEEDS_CSS = `${FEED_SCOPES.flatMap((scope) =>
  SHORTS_SHELVES.split(', ').map((shelf) => `${scope} ${shelf}`)
).join(',\n')} { display: none !important; }`

const HIDE_SIDEBAR_STYLE_ID = 'shorts-hide-watch-sidebar'
// ytd-watch-next-secondary-results-renderer is live-DOM confirmed; that a Shorts shelf inside it is a
// ytd-reel-shelf-renderer is the standard shape but has not been captured directly - verify visually.
const HIDE_SIDEBAR_CSS = `ytd-watch-next-secondary-results-renderer :is(${SHORTS_SHELVES}) {
  display: none !important;
}`

let lastAppliedKey: string | null = null
let applyGeneration = 0

export function applyShortsSettings(settings: Settings['shorts']): void {
  toggleCSS(HIDE_FEEDS_STYLE_ID, HIDE_FEEDS_CSS, settings.hideInFeeds)
  toggleCSS(HIDE_SIDEBAR_STYLE_ID, HIDE_SIDEBAR_CSS, settings.hideInWatchSidebar)
  applyDefaultQuality(settings.defaultQuality)
}

function toggleCSS(id: string, css: string, enabled: boolean): void {
  if (enabled) setInjectedCSS(id, css)
  else clearInjectedCSS(id)
}

/**
 * Sends the desired quality for the current Short.
 *
 * This used to run a MutationObserver over `ytd-shorts` and re-call setPlaybackQualityRange on each
 * DOM change. That call was a no-op, because the player API is invisible to this isolated world (see
 * ../bridge/protocol.ts), and the trigger rested on an unverified assumption about how YouTube swaps
 * reel renderers.
 *
 * The key includes the href on purpose. YouTube fires `yt-navigate-finish` for every scroll between
 * Shorts, so keying per Short re-sends the command for each clip. Keying on the quality alone would
 * send once and then early-return forever, and the MAIN-world script's `loadstart` re-apply cannot
 * cover the gap by itself: a gapless transition can begin the next Short without a fresh loadstart.
 *
 * 'auto' is sent rather than skipped, so that switching the setting back to automatic clears the
 * remembered value in the MAIN world. Skipping it would leave the last forced quality being
 * re-applied to every later clip with no way to get YouTube's adaptive selection back.
 */
function applyDefaultQuality(defaultQuality: QualityLevel): void {
  if (getYouTubePageType() !== 'shorts') return

  const key = `${location.href}|${defaultQuality}`
  if (key === lastAppliedKey) return

  const generation = ++applyGeneration

  void (async () => {
    const applied = await sendPlayerCommand({ op: 'setQuality', player: 'shorts', quality: defaultQuality })
    if (generation !== applyGeneration) return
    // Only commit on a confirmed write, so a Short that was still mounting stays retryable
    if (applied) lastAppliedKey = key
  })()
}
