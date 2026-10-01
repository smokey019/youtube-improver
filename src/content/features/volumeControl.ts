import type { Settings } from '../../types/settings'
import { sendPlayerCommand, sendPlayerCommandForResult } from '../bridge/playerBridge'
import { getYouTubePageType } from '../lib/youtubeNav'

/**
 * Default volume, and mouse-wheel volume over the player.
 *
 * Both go through the MAIN-world bridge. setVolume/getVolume/isMuted/unMute are page-world expandos on
 * the player element, invisible to this isolated content script (see ../bridge/protocol.ts). An earlier
 * version called them directly here behind `typeof ... === 'function'` guards that were always false,
 * and silently fell through to writing `video.volume` on the media element instead.
 *
 * That fallback is why the volume kept collapsing. Writing the element does change the audio, but
 * YouTube's player keeps its own volume model and never learned about it, so its periodic heartbeat
 * stamped its own remembered value back over the user's - captured as
 * `heartbeat.js onSuccess -> setVolume -> video.volume = 0.05`, roughly once a minute, landing on
 * YouTube's remembered 5% rather than on anything this extension had configured. Setting volume through
 * the player API updates the model the heartbeat re-asserts from, so the two no longer fight.
 */

const WATCH_PLAYER_SELECTOR = '#movie_player'
const SHORTS_PLAYER_SELECTOR = '#shorts-player'
const INDICATOR_CLASS = 'ytimprover-volume-indicator'
const INDICATOR_HIDE_MS = 700

const PIXELS_PER_NOTCH = 100
const LINES_PER_NOTCH = 3
/** Below this, an opposite-sign delta is treated as trackpad jitter rather than a deliberate reversal. */
const REVERSAL_THRESHOLD_NOTCHES = 0.2
/**
 * Ceiling on how many notches one wheel event may deliver.
 *
 * deltaY is unbounded - a trackpad fling or a high "lines to scroll" setting can deliver several
 * hundred pixels in a single event, which scaled to a 45-point jump and slammed the volume to the 0
 * floor in one flick. The clamp at the end hid the overshoot, so the volume simply appeared to drop
 * out. Four notches is far more than any deliberate single movement.
 */
const MAX_NOTCHES_PER_EVENT = 4

let latestSettings: Settings['volume'] | null = null
let wheelListenerRegistered = false
let appliedForKey: string | null = null
let overrodeForKey: string | null = null
let applyGeneration = 0
let volumeAccumulator = 0
const indicatorTimers = new WeakMap<HTMLElement, number>()

type PlayerKind = 'watch' | 'shorts'

function isPlayerElement(node: EventTarget): node is HTMLElement {
  return node instanceof HTMLElement && (node.id === 'movie_player' || node.id === 'shorts-player')
}

/**
 * Identifies the clip, not the URL.
 *
 * Deliberately NOT `location.href`. YouTube rewrites the watch URL in place, with no navigation, for
 * things that have nothing to do with which clip is playing: a `t=` from a chapter or a comment
 * timestamp, a `list=`/`index=` gaining a queue context, a refreshed `pp=`. Keying on the whole href
 * meant any of those silently revoked the user's wheel override and re-armed the default-volume write
 * on a video they had never left.
 */
function currentVideoKey(): string | null {
  const pageType = getYouTubePageType()
  if (pageType === 'watch') {
    const id = new URLSearchParams(location.search).get('v')
    return id ? `watch:${id}` : null
  }
  if (pageType === 'shorts') {
    const id = location.pathname.split('/')[2]
    return id ? `shorts:${id}` : null
  }
  return null
}

function volumeKey(defaultVolume: number): string | null {
  const video = currentVideoKey()
  return video === null ? null : `${video}|${defaultVolume}`
}

/** null on pages with no primary player, so nothing below ever runs on feeds, search or channel pages. */
function playerKindForPage(): PlayerKind | null {
  const pageType = getYouTubePageType()
  if (pageType === 'watch') return 'watch'
  if (pageType === 'shorts') return 'shorts'
  return null
}

function selectorFor(kind: PlayerKind): string {
  return kind === 'shorts' ? SHORTS_PLAYER_SELECTOR : WATCH_PLAYER_SELECTOR
}

/**
 * Visibility is the discriminator, not document order: YouTube's SPA keeps the previously-visited page's
 * player mounted but hidden, and it can still match while the incoming player is mid-construction.
 */
function findVisiblePlayer(selector: string): HTMLElement | null {
  const players = Array.from(document.querySelectorAll<HTMLElement>(selector))
  return players.find((player) => player.getBoundingClientRect().height > 0) ?? null
}

function showIndicator(player: HTMLElement, volume: number): void {
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

  // Capped after accumulation so the remainder is not carried: a fling should be ignored, not queued up
  // to be delivered over the following events.
  if (Math.abs(whole) > MAX_NOTCHES_PER_EVENT * step) {
    volumeAccumulator = 0
    return Math.sign(whole) * MAX_NOTCHES_PER_EVENT * step
  }
  return whole
}

function handleWheel(event: WheelEvent): void {
  const settings = latestSettings
  if (!settings?.wheelVolumeEnabled || event.deltaY === 0) return
  // ctrl/meta wheel is browser zoom; other modifiers drive page-level gestures - leave them all alone
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return

  const kind = playerKindForPage()
  if (!kind) return

  const hit = event.composedPath().find(isPlayerElement)
  // Must be the page's own primary player. The miniplayer and YouTube's inline hover previews reuse the id
  // movie_player, and claiming those would swallow feed scrolling.
  if (!hit || hit !== findVisiblePlayer(selectorFor(kind))) return

  // Consumed even when the accumulated delta is short of a whole point, so the page never scrolls
  // mid-adjustment and Shorts never advances (stopImmediatePropagation also covers YouTube's own
  // window-level listeners, which plain stopPropagation would not)
  event.preventDefault()
  event.stopImmediatePropagation()

  const step = Math.min(25, Math.max(1, Math.round(settings.wheelVolumeStep)))
  const points = volumePointsFromWheel(event, step)
  if (points === 0) return

  // Marked before the round trip, not after: the command is in flight for as long as the bridge takes,
  // and a navigation landing in that window must not be able to re-apply the default over this.
  const key = volumeKey(settings.defaultVolume)
  if (key !== null) overrodeForKey = key

  void (async () => {
    // The player does the read-modify-write in one step, so fast scrolling cannot lose notches to a
    // read that raced a concurrent write.
    const result = await sendPlayerCommandForResult({
      op: 'adjustVolume',
      player: kind,
      delta: points,
      unmute: points > 0,
    })
    if (!result.applied || result.value === null) return
    // Shows the player's own reading rather than what we asked for, so the number on screen and
    // YouTube's slider cannot disagree.
    showIndicator(hit, Math.round(result.value))
  })()
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
    overrodeForKey = null
    return
  }

  const kind = playerKindForPage()
  if (!kind) {
    // Pages with no player: cancel in-flight work but keep appliedForKey, so returning to a video does not
    // overwrite a volume the user set before navigating away
    applyGeneration += 1
    return
  }

  const key = volumeKey(settings.defaultVolume)
  if (key === null || key === appliedForKey || key === overrodeForKey) return

  const generation = ++applyGeneration

  void (async () => {
    const applied = await sendPlayerCommand({ op: 'setVolume', player: kind, volume: settings.defaultVolume })

    // Re-validated after the round trip: the setting may have been switched off, the user may have
    // navigated on, and the user may have taken this video over with the wheel while we waited.
    if (generation !== applyGeneration) return
    if (latestSettings?.setDefaultVolume !== true || overrodeForKey === key) return

    // Committed only once the bridge confirms a player method actually ran. A command that expired
    // waiting for a player stays eligible for the next navigation rather than being marked done.
    //
    // There is deliberately no re-assert on loadedmetadata any more. That existed to beat YouTube's own
    // volume restore, which was a fight this feature could not win while it wrote the media element
    // directly. Going through the player API means YouTube now restores *this* value, so re-asserting
    // would only risk overwriting a change the user made in the meantime.
    if (applied) appliedForKey = key
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
