import { getSettings, onSettingsChanged, type Settings } from '../types/settings'
import { initPlayerBridge } from './bridge/playerBridge'
import { initVolumeDiagIsolated } from './diag/volumeDiag'
import { onYouTubeNavigate } from './lib/youtubeNav'
import { applyHomePage } from './features/homePage'
import { applySubscriptionsPage } from './features/subscriptionsPage'
import { applyShortsSettings } from './features/shortsQuality'
import { applyVideoSettings } from './features/videoQuality'
import { applyVolumeControl } from './features/volumeControl'
import { applyAutoplayControl } from './features/autoplayControl'
import { applyHideElements } from './features/hideElements'
import { applyTheaterCinemaMode } from './features/theaterCinemaMode'

function applyAll(settings: Settings): void {
  applyHomePage(settings.homePage)
  applySubscriptionsPage(settings.subscriptionsPage)
  applyShortsSettings(settings.shorts)
  applyVideoSettings(settings.video)
  applyVolumeControl(settings.volume)
  applyAutoplayControl(settings.autoplay)
  applyHideElements(settings.hide)
  applyTheaterCinemaMode(settings.theater)
}

async function main(): Promise<void> {
  // Before the awaited settings read, so we are listening when the MAIN-world script announces itself
  initPlayerBridge()

  // Before applyAll can run, so the probe catches the extension's very first volume write.
  // Inert unless localStorage['ytimprover-diag'] === '1'. Temporary - see ./diag/channel.ts.
  initVolumeDiagIsolated()

  let settings = await getSettings()
  onYouTubeNavigate(() => applyAll(settings))
  onSettingsChanged((updated) => {
    settings = updated
    applyAll(settings)
  })
}

main()
