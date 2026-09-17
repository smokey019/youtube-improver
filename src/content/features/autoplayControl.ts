import type { Settings } from '../../types/settings'

const AUTONAV_TOGGLE_SELECTOR = '.ytp-autonav-toggle-button'
const VIDEO_SELECTOR = 'video'
const AUTOPLAY_GRACE_MS = 1500

let latestSettings: Settings['autoplay'] = {
  disableAutoplay: false,
  blockBackgroundTabAutoplay: false,
  blockForegroundTabAutoplay: false,
  ignoreForPlaylists: true,
}

let registeredVideoElement: HTMLVideoElement | null = null
let visibilityListenerRegistered = false
let lastVideoIdentity = ''
let freshLoadAt = 0

function getAutonavToggle(): { button: HTMLElement; isOn: boolean } | null {
  const button = document.querySelector<HTMLElement>(AUTONAV_TOGGLE_SELECTOR)
  if (!button) return null
  const stateHolder =
    (button.hasAttribute('aria-checked') ? button : null) ??
    button.closest<HTMLElement>('[aria-checked]') ??
    button.querySelector<HTMLElement>('[aria-checked]')
  const checkedAttr = stateHolder?.getAttribute('aria-checked')
  if (checkedAttr == null) return null
  return { button, isOn: checkedAttr === 'true' }
}

function applyDisableAutoplayToggle(): void {
  const toggle = getAutonavToggle()
  if (toggle?.isOn) toggle.button.click()
}

function maybeBlockAutoplay(video: HTMLVideoElement): void {
  if (latestSettings.ignoreForPlaylists && new URLSearchParams(location.search).has('list')) return

  // Heuristic only: YouTube exposes no signal for "was this play autoplay vs. user-initiated", so we
  // treat any play landing within a short grace window after a fresh video/page load as autoplay.
  const withinGraceWindow = Date.now() - freshLoadAt < AUTOPLAY_GRACE_MS

  if (latestSettings.blockForegroundTabAutoplay && !document.hidden && withinGraceWindow) {
    video.pause()
    return
  }
  if (latestSettings.blockBackgroundTabAutoplay && document.hidden && withinGraceWindow) {
    video.pause()
  }
}

function ensureVisibilityListener(): void {
  if (visibilityListenerRegistered) return
  visibilityListenerRegistered = true
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && registeredVideoElement && !registeredVideoElement.paused) {
      maybeBlockAutoplay(registeredVideoElement)
    }
  })
}

function ensureVideoListener(video: HTMLVideoElement): void {
  if (registeredVideoElement === video) return
  registeredVideoElement = video
  video.addEventListener('play', () => maybeBlockAutoplay(video))
}

export function applyAutoplayControl(settings: Settings['autoplay']): void {
  latestSettings = settings

  if (settings.disableAutoplay) applyDisableAutoplayToggle()

  const video = document.querySelector<HTMLVideoElement>(VIDEO_SELECTOR)
  if (!video) return

  const identity = `${location.href}::${video.currentSrc}`
  if (identity !== lastVideoIdentity) {
    lastVideoIdentity = identity
    freshLoadAt = Date.now()
  }

  ensureVideoListener(video)
  ensureVisibilityListener()
}
