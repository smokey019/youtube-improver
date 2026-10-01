import type { Settings } from '../../types/settings'
import { clearInjectedCSS, setInjectedCSS } from '../lib/dom'
import { getYouTubePageType } from '../lib/youtubeNav'
import { wrappingMetadataCSS } from '../lib/gridMetadata'

// YouTube's SPA keeps the previously-visited feed's ytd-browse mounted but hidden, so scope to the live one
const SUBSCRIPTIONS_BROWSE_SELECTOR = 'ytd-browse[page-subtype="subscriptions"]:not([hidden])'
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
  // YouTube sizes each item as width: calc(100%/var(--ytd-rich-grid-items-per-row) - item-margin) inside a
  // flex row, and sets that var inline per viewport - so !important is required to win. Overriding the var
  // (rather than forcing display:grid) is what keeps full-width shelf rows from collapsing into one column.
  setInjectedCSS(
    GRID_COLUMNS_CSS_ID,
    `${SUBSCRIPTIONS_BROWSE_SELECTOR} ytd-rich-grid-renderer { --ytd-rich-grid-items-per-row: ${columns} !important; }
${wrappingMetadataCSS(SUBSCRIPTIONS_BROWSE_SELECTOR)}`
  )
}
