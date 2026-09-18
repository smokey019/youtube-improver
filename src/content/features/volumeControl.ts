import type { Settings } from '../../types/settings'
import { waitForElement } from '../lib/dom'
import { getYouTubePageType } from '../lib/youtubeNav'

const WATCH_PLAYER_SELECTOR = '#movie_player'
const SHORTS_PLAYER_SELECTOR = '#shorts-player'
const INDICATOR_CLASS = 'ytimprover-volume-indicator'
const INDICATOR_HIDE_MS = 700

const PIXELS_PER_NOTCH = 100
const LINES_PER_NOTCH = 3
/** Below this, an opposite-sign delta is treated as trackpad jitter rather than a deliberate reversal. */
const REVERSAL_THRESHOLD_NOTCHES = 0.2

const PLAYER_POLL_INTERVAL_MS = 150
const PLAYER_POLL_ATTEMPTS = 40

interface YouTubePlayerElement extends HTMLElement {
  setVolume?: (volume: number) => void
  getVolume?: () => number
  isMuted?: () => boolean
  unMute?: () => void
}

let latestSettings: Settings['volume'] | null = null
let wheelListenerRegistered = false
let appliedForKey: string | null = null
let overrodeForKey: string | null = null
let applyGeneration = 0
let volumeAccumulator = 0
const indicatorTimers = new WeakMap<HTMLElement, number>()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isPlayerElement(node: EventTarget): node is YouTubePlayerElement {
  return node instanceof HTMLElement && (node.id === 'movie_player' || node.id === 'shorts-player')
}

function volumeKey(defaultVolume: number): string {
  return `${location.href}|${defaultVolume}`
}

/** null on pages with no primary player, so nothing below ever runs on feeds, search or channel pages. */
function playerSelectorForPage(): string | null {
  const pageType = getYouTubePageType()
  if (pageType === 'watch') return WATCH_PLAYER_SELECTOR
  if (pageType === 'shorts') return SHORTS_PLAYER_SELECTOR
  return null
}

/**
 * Visibility is the discriminator, not document order: YouTube's SPA keeps the previously-visited page's
 * player mounted but hidden, and it can still match while the incoming player is mid-construction.
 */
function findVisiblePlayer(selector: string): YouTubePlayerElement | null {
  const players = Array.from(document.querySelectorAll<YouTubePlayerElement>(selector))
  return players.find((player) => player.getBoundingClientRect().height > 0) ?? null
}

async function waitForVisiblePlayer(selector: string, generation: number): Promise<YouTubePlayerElement | null> {
  for (let attempt = 0; attempt < PLAYER_POLL_ATTEMPTS; attempt += 1) {
    if (generation !== applyGeneration) return null
    const player = findVisiblePlayer(selector)
    if (player) return player
    await delay(PLAYER_POLL_INTERVAL_MS)
  }
  return null
}

function readVolume(player: YouTubePlayerElement): number | null {
  if (typeof player.getVolume === 'function') return player.getVolume()
  const video = player.querySelector('video')
  return video ? Math.round(video.volume * 100) : null
}

/** Returns false when neither the player API nor a <video> was ready, so callers can retry later. */
function writeVolume(player: YouTubePlayerElement, volume: number, options: { unmute: boolean }): boolean {
  const clamped = Math.min(100, Math.max(0, Math.round(volume)))
  let wrote = false

  if (typeof player.setVolume === 'function') {
    player.setVolume(clamped)
    wrote = true
  } else {
    const video = player.querySelector('video')
    if (video) {
      video.volume = clamped / 100
      wrote = true
    }
  }

  // Only the wheel path may unmute. Unmuting from the default-volume path would override a mute the user
  // deliberately set, on every single video load.
  if (wrote && options.unmute && clamped > 0 && player.isMuted?.() === true) {
    player.unMute?.()
  }

  return wrote
}

function showIndicator(player: YouTubePlayerElement, volume: number): void {
  let indicator = player.querySelector<HTMLElement>(`.${INDICATOR_CLASS}`)
  if (!indicator) {
    indicator = document.createElement('div')
    indicator.className = INDICATOR_CLASS
    // Lives inside the player so it stays visible in fullscreen, where a body-level overlay would not
    Object.assign(indicator.style, {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      padding: '10px 16px',
      borderRadius: '8px',
      background: 'rgba(0, 0, 0, 0.8)',
      color: '#fff',
      font: '500 18px/1 Roboto, Arial, sans-serif',
      zIndex: '60',
      pointerEvents: 'none',
      transition: 'opacity 0.2s ease',
    })
    player.appendChild(indicator)
  }

  indicator.textContent = `${volume}%`
  indicator.style.opacity = '1'

  // Timers are per indicator: a shared handle would let one player's wheel cancel another's pending fade,
  // stranding a stale overlay at full opacity
  const element = indicator
  window.clearTimeout(indicatorTimers.get(element))
  indicatorTimers.set(
    element,
    window.setTimeout(() => {
      element.style.opacity = '0'
    }, INDICATOR_HIDE_MS)
  )
}

/**
 * Converts a wheel event into whole volume points, accumulating the fractional remainder.
 *
 * Deltas are scaled rather than quantised into notches: one ~100px notch moves volume by the configured
 * step whether the device sends that as one large delta or thirty small ones. Quantising instead meant any
 * device whose detent summed to less than a notch (high-resolution wheels, slow trackpad drags) produced no
 * change at all, and any device sending more than 100px per notch produced intermittent double steps.
 */
function volumePointsFromWheel(event: WheelEvent, step: number): number {
  const perNotch =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? LINES_PER_NOTCH
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? 1
        : PIXELS_PER_NOTCH

  const notches = event.deltaY / perNotch
  // Wheel up sends a negative deltaY and should raise the volume
  const points = -notches * step

  const reversed = Math.sign(points) !== Math.sign(volumeAccumulator)
  if (reversed && Math.abs(notches) > REVERSAL_THRESHOLD_NOTCHES) volumeAccumulator = 0

  volumeAccumulator += points
  const whole = Math.trunc(volumeAccumulator)
  volumeAccumulator -= whole
  return whole
}

function handleWheel(event: WheelEvent): void {
  const settings = latestSettings
  if (!settings?.wheelVolumeEnabled || event.deltaY === 0) return
  // ctrl/meta wheel is browser zoom; other modifiers drive page-level gestures - leave them all alone
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return

  const selector = playerSelectorForPage()
  if (!selector) return

  const hit = event.composedPath().find(isPlayerElement)
  // Must be the page's own primary player. The miniplayer and YouTube's inline hover previews reuse the id
  // movie_player, and claiming those would swallow feed scrolling.
  if (!hit || hit !== findVisiblePlayer(selector)) return

  // Consumed even when the accumulated delta is short of a whole point, so the page never scrolls
  // mid-adjustment and Shorts never advances (stopImmediatePropagation also covers YouTube's own
  // window-level listeners, which plain stopPropagation would not)
  event.preventDefault()
  event.stopImmediatePropagation()

  const step = Math.min(25, Math.max(1, Math.round(settings.wheelVolumeStep)))
  const points = volumePointsFromWheel(event, step)
  if (points === 0) return

  const current = readVolume(hit)
  if (current === null) return

  const next = Math.min(100, Math.max(0, current + points))
  overrodeForKey = volumeKey(settings.defaultVolume)
  // Unmute only when turning up, or scrolling down on a muted player would make it audible
  writeVolume(hit, next, { unmute: points > 0 })
  showIndicator(hit, next)
}

function registerWheelListener(): void {
  if (wheelListenerRegistered) return
  wheelListenerRegistered = true
  // Window capture runs before YouTube's handlers; passive: false is required for preventDefault
  window.addEventListener('wheel', handleWheel, { passive: false, capture: true })
}

function applyDefaultVolume(settings: Settings['volume']): void {
  if (!settings.setDefaultVolume) {
    // Cancels anything in flight, and forgetting the key means re-enabling applies again immediately
    applyGeneration += 1
    appliedForKey = null
    return
  }

  const selector = playerSelectorForPage()
  if (!selector) {
    // Pages with no player: cancel in-flight work but keep appliedForKey, so returning to a video does not
    // overwrite a volume the user set before navigating away
    applyGeneration += 1
    return
  }

  const key = volumeKey(settings.defaultVolume)
  if (key === appliedForKey || key === overrodeForKey) return

  const generation = ++applyGeneration

  void (async () => {
    if (!(await waitForElement(selector)) || generation !== applyGeneration) return

    const player = await waitForVisiblePlayer(selector, generation)
    if (!player || generation !== applyGeneration) return

    const video = await waitForElement<HTMLVideoElement>('video', { root: player })
    if (!video || generation !== applyGeneration) return

    // Re-validated after the awaits: the setting may have been switched off, and the user may have taken
    // this video over with the wheel while we were waiting
    if (latestSettings?.setDefaultVolume !== true || overrodeForKey === key) return

    // Key committed only after a real write, so an attempt that lands before the API is ready stays
    // eligible for retry on the next navigation or settings event
    if (!writeVolume(player, settings.defaultVolume, { unmute: false })) return
    appliedForKey = key

    const reassert = (): void => {
      if (generation === applyGeneration && overrodeForKey !== key) {
        writeVolume(player, settings.defaultVolume, { unmute: false })
      }
    }

    // The player restores YouTube's own remembered volume during init, which can land after our write.
    // Both paths run because the reused <video> can still report the previous video's readyState, and the
    // write is idempotent.
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) reassert()
    video.addEventListener('loadedmetadata', reassert, { once: true })
  })()
}

// Registered at module load rather than from applyVolumeControl, which only runs after an awaited settings
// read - by then YouTube has bound its own wheel handlers and a same-phase listener registered later loses.
// handleWheel is inert until latestSettings arrives.
registerWheelListener()

export function applyVolumeControl(settings: Settings['volume']): void {
  latestSettings = settings
  registerWheelListener()
  applyDefaultVolume(settings)
}
