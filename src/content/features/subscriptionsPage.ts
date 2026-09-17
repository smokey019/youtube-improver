import type { Settings } from '../../types/settings'
import { clearInjectedCSS, setInjectedCSS, waitForElement } from '../lib/dom'
import { getYouTubePageType } from '../lib/youtubeNav'

const SUBSCRIPTIONS_BROWSE_SELECTOR = 'ytd-browse[page-subtype="subscriptions"]'
const SHORTS_SHELF_CSS_ID = 'subscriptions-hide-shorts'
const GRID_COLUMNS_CSS_ID = 'subscriptions-grid-columns'
const VIEW_TOGGLE_CONTROL_SELECTOR = 'button, yt-icon-button, tp-yt-paper-icon-button, [role="button"]'

let lastAppliedViewKey: string | null = null

export function applySubscriptionsPage(settings: Settings['subscriptionsPage']): void {
  const isSubscriptionsPage = getYouTubePageType() === 'subscriptions'

  if (!settings.enabled || !isSubscriptionsPage) {
    clearInjectedCSS(SHORTS_SHELF_CSS_ID)
    clearInjectedCSS(GRID_COLUMNS_CSS_ID)
    if (!isSubscriptionsPage) lastAppliedViewKey = null
    return
  }

  applyHideShorts(settings.hideShorts)
  applyVideosPerRow(settings.videosPerRow)
  maybeApplyDefaultView(settings.defaultView)
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
  // --ytd-rich-grid-items-per-row is an undocumented internal var YouTube's own layout reads; the explicit grid-template-columns below is a fallback in case that stops being honored
  setInjectedCSS(
    GRID_COLUMNS_CSS_ID,
    `${SUBSCRIPTIONS_BROWSE_SELECTOR} ytd-rich-grid-renderer {
  --ytd-rich-grid-items-per-row: ${columns};
}
${SUBSCRIPTIONS_BROWSE_SELECTOR} ytd-rich-grid-renderer #contents.ytd-rich-grid-renderer {
  display: grid !important;
  grid-template-columns: repeat(${columns}, minmax(0, 1fr)) !important;
}`
  )
}

function maybeApplyDefaultView(defaultView: 'grid' | 'list'): void {
  // Keyed on href+view (not just href) so a settings-only change on the same page still re-attempts
  const key = `${location.href}|${defaultView}`
  if (key === lastAppliedViewKey) return
  lastAppliedViewKey = key
  void trySetDefaultView(defaultView, location.href)
}

async function trySetDefaultView(defaultView: 'grid' | 'list', forHref: string): Promise<void> {
  const browse = await waitForElement<HTMLElement>(SUBSCRIPTIONS_BROWSE_SELECTOR, { timeoutMs: 8000 })
  if (!browse || location.href !== forHref || getYouTubePageType() !== 'subscriptions') return

  const candidates = Array.from(browse.querySelectorAll<HTMLElement>(VIEW_TOGGLE_CONTROL_SELECTOR))
  const labelOf = (el: HTMLElement): string =>
    `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`.toLowerCase()

  const gridBtn = candidates.find((el) => labelOf(el).includes('grid'))
  const listBtn = candidates.find((el) => labelOf(el).includes('list'))
  if (!gridBtn || !listBtn || gridBtn === listBtn) return

  const isPressed = (el: HTMLElement): boolean => {
    const pressed = el.getAttribute('aria-pressed')
    const selected = el.getAttribute('aria-selected')
    if (pressed != null) return pressed === 'true'
    if (selected != null) return selected === 'true'
    return el.classList.contains('selected') || el.classList.contains('active')
  }

  const gridPressed = isPressed(gridBtn)
  const listPressed = isPressed(listBtn)
  // Identical results here mean neither control exposes a trustworthy pressed/selected signal, so bail rather than guess
  if (gridPressed === listPressed) return

  const currentView: 'grid' | 'list' = gridPressed ? 'grid' : 'list'
  if (currentView === defaultView) return

  ;(defaultView === 'grid' ? gridBtn : listBtn).click()
}
