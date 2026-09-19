import type { Settings } from '../../types/settings'
import { sendPlayerCommand } from '../bridge/playerBridge'
import { getYouTubePageType } from '../lib/youtubeNav'

/**
 * Default quality and playback speed for regular watch pages.
 *
 * Both go through the MAIN-world bridge: setPlaybackQualityRange and setPlaybackRate live on the
 * player element as page-world expandos, which this isolated content script cannot see at all. An
 * earlier version called them directly here, guarded by a `typeof ... === 'function'` check that was
 * always false, so this feature silently did nothing. See ../bridge/protocol.ts.
 */

let lastAppliedKey: string | null = null
let applyGeneration = 0
let latestVideoSettings: Settings['video'] | null = null
let fullscreenListenerRegistered = false

export function applyVideoSettings(settings: Settings['video']): void {
  latestVideoSettings = settings

  if (getYouTubePageType() !== 'watch') return

  registerFullscreenListener()

  // Keyed on href+quality+speed (not just href) so a settings-only change on the same video re-applies
  const key = `${location.href}|${settings.defaultQuality}|${settings.defaultPlaybackSpeed}`
  if (key === lastAppliedKey) return

  const generation = ++applyGeneration

  void (async () => {
    const [qualityApplied, rateApplied] = await Promise.all([
      sendPlayerCommand({ op: 'setQuality', player: 'watch', quality: settings.defaultQuality }),
      sendPlayerCommand({ op: 'setPlaybackRate', player: 'watch', rate: settings.defaultPlaybackSpeed }),
    ])

    if (generation !== applyGeneration) return
    // Committed only once the bridge confirms a player method actually ran. A command that expired
    // waiting for a player stays eligible for the next navigation or settings change rather than
    // being silently marked done - which is what made the original bug invisible.
    if (qualityApplied && rateApplied) lastAppliedKey = key
  })()
}

function registerFullscreenListener(): void {
  if (fullscreenListenerRegistered) return
  fullscreenListenerRegistered = true
  document.addEventListener('fullscreenchange', () => {
    const settings = latestVideoSettings
    if (!settings || getYouTubePageType() !== 'watch') return
    const fullscreenQuality =
      settings.defaultQualityFullscreen === 'auto' ? settings.defaultQuality : settings.defaultQualityFullscreen
    void sendPlayerCommand({
      op: 'setQuality',
      player: 'watch',
      quality: document.fullscreenElement ? fullscreenQuality : settings.defaultQuality,
    })
  })
}
