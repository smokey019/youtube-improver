import type { Settings } from '../../types/settings'
import { clearInjectedCSS, setInjectedCSS } from '../lib/dom'
import { getYouTubePageType } from '../lib/youtubeNav'

const SUBSCRIPTIONS_BROWSE_SELECTOR = 'ytd-browse[page-subtype="subscriptions"]'
const SHORTS_SHELF_CSS_ID = 'subscriptions-hide-shorts'
const GRID_COLUMNS_CSS_ID = 'subscriptions-grid-columns'

export function applySubscriptionsPage(settings: Settings['subscriptionsPage']): void {
  const isSubscriptionsPage = getYouTubePageType() === 'subscriptions'

  if (!settings.enabled || !isSubscriptionsPage) {
    clearInjectedCSS(SHORTS_SHELF_CSS_ID)
    clearInjectedCSS(GRID_COLUMNS_CSS_ID)
    return
  }

  applyHideShorts(settings.hideShorts)
  applyVideosPerRow(settings.videosPerRow)
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
${SUBSCRIPTIONS_BROWSE_SELECTOR} ytd-rich-grid-renderer #contents {
  display: grid !important;
  grid-template-columns: repeat(${columns}, minmax(0, 1fr)) !important;
}`
  )
}
