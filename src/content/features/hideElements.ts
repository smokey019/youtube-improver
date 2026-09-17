import type { Settings } from '../../types/settings'
import { setInjectedCSS, clearInjectedCSS } from '../lib/dom'

const CSS_ID_COMMENTS = 'hide-comments'
const CSS_ID_RELATED_VIDEOS = 'hide-related-videos'

const SELECTOR_COMMENTS = 'ytd-comments#comments'
const SELECTOR_RELATED_VIDEOS = 'ytd-watch-next-secondary-results-renderer'

export function applyHideElements(settings: Settings['hide']): void {
  if (settings.comments) {
    setInjectedCSS(CSS_ID_COMMENTS, `${SELECTOR_COMMENTS} { display: none !important; }`)
  } else {
    clearInjectedCSS(CSS_ID_COMMENTS)
  }

  if (settings.relatedVideos) {
    setInjectedCSS(
      CSS_ID_RELATED_VIDEOS,
      `${SELECTOR_RELATED_VIDEOS} { display: none !important; }`
    )
  } else {
    clearInjectedCSS(CSS_ID_RELATED_VIDEOS)
  }
}
