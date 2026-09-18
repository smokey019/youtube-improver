import type { Settings } from '../../types/settings'
import { waitForElement } from '../lib/dom'
import { getYouTubePageType } from '../lib/youtubeNav'

const PLAYER_SELECTOR = '#movie_player'

interface YouTubePlayerElement extends HTMLElement {
  setPlaybackQualityRange?: (min: string, max: string) => void
  setPlaybackRate?: (rate: number) => void
}

let lastAppliedKey: string | null = null
let applyGeneration = 0
let latestVideoSettings: Settings['video'] | null = null
let fullscreenListenerRegistered = false

export function applyVideoSettings(settings: Settings['video']): void {
  latestVideoSettings = settings

  if (getYouTubePageType() !== 'watch') return

  registerFullscreenListener()

  // Keyed on href+quality+speed (not just href) so a settings-only change on the same video still re-applies
  const key = `${location.href}|${settings.defaultQuality}|${settings.defaultPlaybackSpeed}`
  if (key === lastAppliedKey) return

  const generation = ++applyGeneration

  void (async () => {
    const player = await waitForElement<YouTubePlayerElement>(PLAYER_SELECTOR)
    if (!player || generation !== applyGeneration || getYouTubePageType() !== 'watch') return

    // The player element can be inserted before YouTube attaches its imperative API, so wait for the media
    const video = await waitForElement('video', { root: player })
    if (!video || generation !== applyGeneration) return

    // Key committed only after a real write, so an attempt that lands before the API is ready gets retried
    // by the next navigation or settings event instead of being silently burned
    if (typeof player.setPlaybackRate !== 'function') return

    applyQuality(player, settings.defaultQuality)
    player.setPlaybackRate(settings.defaultPlaybackSpeed)
    lastAppliedKey = key
  })()
}

function applyQuality(player: YouTubePlayerElement, quality: Settings['video']['defaultQuality']): void {
  if (quality === 'auto') return
  if (typeof player.setPlaybackQualityRange === 'function') {
    player.setPlaybackQualityRange(quality, quality)
  }
}

function registerFullscreenListener(): void {
  if (fullscreenListenerRegistered) return
  fullscreenListenerRegistered = true
  document.addEventListener('fullscreenchange', () => {
    const settings = latestVideoSettings
    if (!settings) return
    const player = document.querySelector<YouTubePlayerElement>(PLAYER_SELECTOR)
    if (!player) return
    const fullscreenQuality =
      settings.defaultQualityFullscreen === 'auto' ? settings.defaultQuality : settings.defaultQualityFullscreen
    applyQuality(player, document.fullscreenElement ? fullscreenQuality : settings.defaultQuality)
  })
}
