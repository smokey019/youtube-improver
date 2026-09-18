export type YouTubePageType = 'home' | 'subscriptions' | 'watch' | 'shorts' | 'other'

export function getYouTubePageType(pathname: string = location.pathname): YouTubePageType {
  if (pathname === '/') return 'home'
  if (pathname.startsWith('/feed/subscriptions')) return 'subscriptions'
  if (pathname.startsWith('/watch')) return 'watch'
  if (pathname.startsWith('/shorts/')) return 'shorts'
  return 'other'
}

/**
 * YouTube is a client-side-routed SPA: content scripts only load once, so page-type-specific
 * logic must re-run on every in-app navigation, not just on initial load. YouTube fires
 * `yt-navigate-finish` on `document` after each such navigation (including Shorts feed scrolls).
 */
export function onYouTubeNavigate(callback: () => void): void {
  callback()
  // The content script runs at document_start, so the first call above can land on an empty DOM. Cold loads
  // need this re-run because yt-navigate-finish is not guaranteed to fire for the initial page.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true })
  }
  if (document.readyState !== 'complete') {
    window.addEventListener('load', callback, { once: true })
  }
  document.addEventListener('yt-navigate-finish', callback)
}
