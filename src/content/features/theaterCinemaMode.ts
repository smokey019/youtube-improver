import type { Settings } from '../../types/settings'
import { waitForElement } from '../lib/dom'
import { getYouTubePageType } from '../lib/youtubeNav'

// :not([hidden]) matters: YouTube's SPA keeps a previous page's ytd-watch-flexy mounted-but-hidden for fast
// back-navigation, and a bare querySelector could otherwise grab that stale instance instead of the live one
const SELECTOR_WATCH_FLEXY = 'ytd-watch-flexy:not([hidden])'
const SELECTOR_THEATER_BUTTON = '.ytp-size-button'
const BACKDROP_ID = 'ytimprover-cinema-backdrop'
// Sits above YT's page background but below masthead (~2065) and player chrome; tune after live-page verification.
const BACKDROP_Z_INDEX = 2000

let lastAutoTheaterAppliedFor = ''

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

function applyAutoTheaterModeOnce(): void {
  if (lastAutoTheaterAppliedFor === location.href) return
  const forHref = location.href
  lastAutoTheaterAppliedFor = forHref

  void (async () => {
    const flexy = await waitForElement<HTMLElement>(SELECTOR_WATCH_FLEXY)
    if (!flexy || location.href !== forHref || flexy.hasAttribute('theater')) return
    // The theater button mounts slightly after ytd-watch-flexy itself, so wait for it too rather than a bare querySelector
    const button = await waitForElement<HTMLElement>(SELECTOR_THEATER_BUTTON)
    if (!button || location.href !== forHref || flexy.hasAttribute('theater')) return
    button.click()
  })()
}

export function applyTheaterCinemaMode(settings: Settings['theater']): void {
  if (getYouTubePageType() !== 'watch') {
    removeBackdrop()
    return
  }

  if (settings.autoTheaterMode) {
    applyAutoTheaterModeOnce()
  }

  if (settings.cinemaMode) {
    const backdrop = ensureBackdrop()
    if (backdrop) {
      backdrop.style.backgroundColor = hexToRgba(settings.cinemaModeColor, settings.cinemaModeOpacity)
    }
  } else {
    removeBackdrop()
  }
}
