import type { QualityLevel, Settings } from '../../types/settings'
import { waitForElement, setInjectedCSS, clearInjectedCSS } from '../lib/dom'
import { getYouTubePageType } from '../lib/youtubeNav'

const HIDE_FEEDS_STYLE_ID = 'shorts-hide-feeds'
const HIDE_FEEDS_CSS =
  'ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer { display: none !important; }'

const SHORTS_PLAYER_SELECTOR = '#shorts-player'
// Best-effort container for the vertical Shorts feed; watched for the active-item attribute below.
const SHORTS_CONTAINER_SELECTOR = 'ytd-shorts'
const REEL_VIDEO_RENDERER_SELECTOR = 'ytd-reel-video-renderer'
const ACTIVE_ITEM_ATTR = 'is-active'

interface ShortsPlayerElement extends HTMLElement {
  setPlaybackQualityRange?: (min: QualityLevel, max: QualityLevel) => void
}

let qualityObserver: MutationObserver | null = null
let desiredQuality: QualityLevel = 'auto'
let observerSetupInFlight = false

export function applyShortsSettings(settings: Settings['shorts']): void {
  applyHideInFeeds(settings.hideInFeeds)
  applyDefaultQuality(settings.defaultQuality)
}

function applyHideInFeeds(hideInFeeds: boolean): void {
  if (hideInFeeds) {
    setInjectedCSS(HIDE_FEEDS_STYLE_ID, HIDE_FEEDS_CSS)
  } else {
    clearInjectedCSS(HIDE_FEEDS_STYLE_ID)
  }
}

function applyDefaultQuality(defaultQuality: QualityLevel): void {
  desiredQuality = defaultQuality

  if (getYouTubePageType() !== 'shorts' || defaultQuality === 'auto') {
    disconnectQualityObserver()
    return
  }

  void setActivePlayerQuality(defaultQuality)
  void ensureQualityObserver()
}

function disconnectQualityObserver(): void {
  qualityObserver?.disconnect()
  qualityObserver = null
}

async function setActivePlayerQuality(quality: QualityLevel): Promise<void> {
  if (quality === 'auto') return
  const player = await waitForElement<ShortsPlayerElement>(SHORTS_PLAYER_SELECTOR)
  if (quality !== desiredQuality) return // stale: a newer quality request superseded this one while we waited
  if (typeof player?.setPlaybackQualityRange === 'function') {
    player.setPlaybackQualityRange(quality, quality)
  }
}

async function ensureQualityObserver(): Promise<void> {
  if (qualityObserver || observerSetupInFlight) return
  observerSetupInFlight = true
  const container = await waitForElement<Element>(SHORTS_CONTAINER_SELECTOR)
  observerSetupInFlight = false

  if (!container || qualityObserver || getYouTubePageType() !== 'shorts' || desiredQuality === 'auto') return

  qualityObserver = new MutationObserver((mutations) => {
    const becameActive = mutations.some(
      (mutation) =>
        mutation.attributeName === ACTIVE_ITEM_ATTR &&
        mutation.target instanceof Element &&
        mutation.target.matches(REEL_VIDEO_RENDERER_SELECTOR) &&
        mutation.target.hasAttribute(ACTIVE_ITEM_ATTR)
    )
    if (becameActive) void setActivePlayerQuality(desiredQuality)
  })

  qualityObserver.observe(container, {
    attributes: true,
    attributeFilter: [ACTIVE_ITEM_ATTR],
    subtree: true,
  })
}
