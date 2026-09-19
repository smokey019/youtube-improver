import type { Settings } from '../../types/settings'
import { waitForElement } from '../lib/dom'

const AUTONAV_TOGGLE_SELECTOR = '.ytp-autonav-toggle-button'
const WATCH_PLAYER_SELECTOR = '#movie_player'
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
let videoGeneration = 0

/**
 * Per-element registration, so revisiting a media element never binds a second listener.
 *
 * The previous single-slot check only compared against the most recent element, and YouTube pools and
 * recycles <video> elements - so alternating watch -> Shorts -> watch re-bound the watch element every
 * time, accumulating a duplicate `play` handler on each round trip.
 */
const listenedVideos = new WeakSet<HTMLVideoElement>()

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

function isPlaylist(): boolean {
  return new URLSearchParams(location.search).has('list')
}

function applyDisableAutoplayToggle(): void {
  // "Ignore these rules for playlists" applies here too. Turning off the autonav toggle is the most
  // disruptive of the three autoplay behaviours in a playlist, since it stops the queue advancing.
  if (latestSettings.ignoreForPlaylists && isPlaylist()) return
  const toggle = getAutonavToggle()
  if (toggle?.isOn) toggle.button.click()
}

function maybeBlockAutoplay(video: HTMLVideoElement): void {
  if (latestSettings.ignoreForPlaylists && isPlaylist()) return

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
  registeredVideoElement = video
  if (listenedVideos.has(video)) return
  listenedVideos.add(video)
  video.addEventListener('play', () => maybeBlockAutoplay(video))
}

/**
 * Resolves the media element inside the visible watch player.
 *
 * A bare `document.querySelector('video')` was wrong twice over: YouTube's SPA keeps the previous
 * page's player mounted but hidden and it can precede the live one in document order, and inline
 * hover previews and the miniplayer carry their own <video> elements. Binding to the wrong one is
 * indistinguishable from the feature being switched off, since either way the video just plays.
 */
function findLiveVideo(): HTMLVideoElement | null {
  const players = Array.from(document.querySelectorAll<HTMLElement>(WATCH_PLAYER_SELECTOR))
  const live = players.find((p) => p.getBoundingClientRect().height > 0) ?? players[0]
  return live?.querySelector<HTMLVideoElement>('video') ?? null
}

export function applyAutoplayControl(settings: Settings['autoplay']): void {
  latestSettings = settings

  const generation = ++videoGeneration

  void (async () => {
    // The content script runs at document_start and YouTube's server HTML contains no <video> at all,
    // so an immediate lookup usually misses and the play event this feature exists to catch has
    // already fired by the time a later pass runs. Wait for the element instead of giving up.
    if (settings.disableAutoplay && (await waitForElement<HTMLElement>(AUTONAV_TOGGLE_SELECTOR))) {
      if (generation !== videoGeneration) return
      applyDisableAutoplayToggle()
    }

    const player = await waitForElement<HTMLElement>(WATCH_PLAYER_SELECTOR)
    if (!player || generation !== videoGeneration) return
    const video = (await waitForElement<HTMLVideoElement>('video', { root: player })) && findLiveVideo()
    if (!video || generation !== videoGeneration) return

    const identity = `${location.href}::${video.currentSrc}`
    if (identity !== lastVideoIdentity) {
      lastVideoIdentity = identity
      freshLoadAt = Date.now()
    }

    ensureVideoListener(video)
    ensureVisibilityListener()

    // Closes the remaining race: if playback began before the listener existed, the `play` event is
    // gone and nothing would ever catch it.
    if (!video.paused) maybeBlockAutoplay(video)
  })()
}
