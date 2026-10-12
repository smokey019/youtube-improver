import type { Settings } from '../../types/settings'
import { clearInjectedCSS, setInjectedCSS } from '../lib/dom'

const CSS_ID_ALTERNATE_BACKGROUNDS = 'comments-alternate-backgrounds'

// The scope class marks threads stamped by the comments list itself. Anything a replies renderer stamps is
// scoped to ytd-comment-replies-renderer instead, so nested threads can't start a stripe sequence of their own.
const SELECTOR_TOP_LEVEL_THREAD = 'ytd-comment-thread-renderer.ytd-item-section-renderer'

// The description box's fill: translucent grey that YouTube redefines for light and dark themes
const BUBBLE_BACKGROUND = 'var(--yt-spec-badge-chip-background, rgba(128, 128, 128, 0.12))'

export function applyCommentStyle(settings: Settings['comments']): void {
  if (!settings.alternateBackgrounds) {
    clearInjectedCSS(CSS_ID_ALTERNATE_BACKGROUNDS)
    return
  }
  // Padding goes on every thread, not just the grey ones, or the grey threads' avatars would sit 12px right of
  // their neighbours'. The padding now does the spacing, so YouTube's own gap between threads is tightened.
  // `of S` counts only threads, so the stripes stay in step past any non-thread sibling (e.g. the loader).
  setInjectedCSS(
    CSS_ID_ALTERNATE_BACKGROUNDS,
    `${SELECTOR_TOP_LEVEL_THREAD} {
  padding: 12px !important;
  margin-bottom: 4px !important;
  border-radius: 12px;
}
${SELECTOR_TOP_LEVEL_THREAD}:nth-child(even of ${SELECTOR_TOP_LEVEL_THREAD}) {
  background: ${BUBBLE_BACKGROUND};
}`
  )
}
