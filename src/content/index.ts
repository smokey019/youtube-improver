import { getSettings, onSettingsChanged, type Settings } from '../types/settings'
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
  let settings = await getSettings()
  onYouTubeNavigate(() => applyAll(settings))
  onSettingsChanged((updated) => {
    settings = updated
    applyAll(settings)
  })
}

main()
