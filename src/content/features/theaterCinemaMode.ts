import type { Settings } from '../../types/settings'
import { waitForElement } from '../lib/dom'
import { getYouTubePageType } from '../lib/youtubeNav'

// :not([hidden]) matters: YouTube's SPA keeps a previous page's ytd-watch-flexy mounted-but-hidden for fast
// back-navigation, and a bare querySelector could otherwise grab that stale instance instead of the live one
const SELECTOR_WATCH_FLEXY = 'ytd-watch-flexy:not([hidden])'
const SELECTOR_THEATER_BUTTON = '.ytp-size-button'
const SELECTOR_PLAYER = '#movie_player'
const BACKDROP_ID = 'ytimprover-cinema-backdrop'
/**
 * Above YouTube's page content. The player is deliberately NOT excluded by z-index, because it cannot
 * be: `.html5-video-player` is `position: relative; z-index: 0`, which makes it a stacking context, so
 * everything inside it is sealed below any root-level positive z-index. Going under instead does not
 * work either, since the page background is opaque. The player is excluded with a clip-path hole.
 */
const BACKDROP_Z_INDEX = 2000

let lastAutoTheaterAppliedFor = ''
let theaterGeneration = 0
let latestTheaterSettings: Settings['theater'] | null = null
let backdropSyncBound = false
let backdropSyncFrame = 0

function hexToRgba(hex: string, opacityPercent: number): string {
  const normalized = hex.replace('#', '')
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized
  const r = parseInt(full.slice(0, 2), 16) || 0
  const g = parseInt(full.slice(2, 4), 16) || 0
  const b = parseInt(full.slice(4, 6), 16) || 0
  const alpha = Math.min(100, Math.max(0, opacityPercent)) / 100
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function getBackdrop(): HTMLDivElement | null {
  return document.getElementById(BACKDROP_ID) as HTMLDivElement | null
}

function ensureBackdrop(): HTMLDivElement | null {
  const existing = getBackdrop()
  if (existing) return existing
  if (!document.body) return null

  const backdrop = document.createElement('div')
  backdrop.id = BACKDROP_ID
  backdrop.style.position = 'fixed'
  backdrop.style.inset = '0'
  backdrop.style.pointerEvents = 'none'
  backdrop.style.zIndex = String(BACKDROP_Z_INDEX)
  document.body.appendChild(backdrop)
  return backdrop
}

function removeBackdrop(): void {
  getBackdrop()?.remove()
}

/**
 * Dims everything except the player, by punching a hole in the backdrop over the player's rect.
 *
 * The outer ring is wound clockwise and the player rect counter-clockwise; under the default nonzero
 * fill rule that leaves the player rect unpainted. Without this the feature did the opposite of its
 * description, covering the video in 85% black while leaving it clickable underneath.
 */
function paintBackdrop(settings: Settings['theater']): void {
  const backdrop = getBackdrop()
  if (!backdrop) return
  backdrop.style.backgroundColor = hexToRgba(settings.cinemaModeColor, settings.cinemaModeOpacity)

  const rect = document.querySelector<HTMLElement>(SELECTOR_PLAYER)?.getBoundingClientRect()
  if (!rect || rect.width < 1 || rect.height < 1) {
    backdrop.style.clipPath = 'none'
    return
  }
  backdrop.style.clipPath =
    `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ` +
    `${rect.left}px ${rect.top}px, ${rect.left}px ${rect.bottom}px, ` +
    `${rect.right}px ${rect.bottom}px, ${rect.right}px ${rect.top}px, ` +
    `${rect.left}px ${rect.top}px, 0 0)`
}

/**
 * Keeps the hole aligned. The backdrop is fixed and the player scrolls, so scrolling matters as much
 * as resizing. Reads are coalesced into one animation frame: getBoundingClientRect forces layout, and
 * doing that synchronously on every scroll event would make scrolling janky.
 */
function ensureBackdropSync(): void {
  if (backdropSyncBound) return
  backdropSyncBound = true
  const resync = (): void => {
    if (backdropSyncFrame) return
    backdropSyncFrame = requestAnimationFrame(() => {
      backdropSyncFrame = 0
      const settings = latestTheaterSettings
      if (settings?.cinemaMode && getBackdrop()) paintBackdrop(settings)
    })
  }
  window.addEventListener('scroll', resync, { passive: true })
  window.addEventListener('resize', resync, { passive: true })
  document.addEventListener('fullscreenchange', resync)
}

function applyAutoTheaterModeOnce(): void {
  if (lastAutoTheaterAppliedFor === location.href) return
  const forHref = location.href
  const generation = ++theaterGeneration

  void (async () => {
    const flexy = await waitForElement<HTMLElement>(SELECTOR_WATCH_FLEXY)
    if (!flexy || generation !== theaterGeneration || location.href !== forHref) return
    if (flexy.hasAttribute('theater')) {
      lastAutoTheaterAppliedFor = forHref
      return
    }

    // The theater button mounts slightly after ytd-watch-flexy itself, so wait for it too
    const button = await waitForElement<HTMLElement>(SELECTOR_THEATER_BUTTON)
    if (!button || generation !== theaterGeneration || location.href !== forHref) return
    if (flexy.hasAttribute('theater')) {
      lastAutoTheaterAppliedFor = forHref
      return
    }

    button.click()
    // Committed on the click itself, not on a follow-up attribute check: Polymer reflects `theater`
    // asynchronously, so verifying too early would leave this unarmed and the next pass would re-click,
    // toggling theater mode back off
    lastAutoTheaterAppliedFor = forHref
  })()
}

export function applyTheaterCinemaMode(settings: Settings['theater']): void {
  latestTheaterSettings = settings

  if (getYouTubePageType() !== 'watch') {
    removeBackdrop()
    return
  }

  if (settings.autoTheaterMode) {
    applyAutoTheaterModeOnce()
  }

  if (settings.cinemaMode) {
    if (ensureBackdrop()) {
      paintBackdrop(settings)
      ensureBackdropSync()
    }
  } else {
    removeBackdrop()
  }
}
