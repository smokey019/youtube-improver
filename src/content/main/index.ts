/**
 * MAIN-world content script.
 *
 * This is the only part of the extension that runs inside youtube.com's own JavaScript context, and it
 * exists for exactly one reason: YouTube's player API methods are page-world expandos on the player
 * element, so the ISOLATED content script cannot see them (see ../bridge/protocol.ts).
 *
 * RULES FOR THIS FILE - it has no privilege boundary against the page.
 *  - Never reference chrome.*, never read or write storage, never import a module that does.
 *  - Never eval, never new Function, never inject a script. The page's CSP applies to us.
 *  - Never throw into the page. YouTube installs window 'error' and 'unhandledrejection' listeners
 *    that feed its own player error telemetry and recovery logic, so an uncaught throw here would be
 *    reported as a YouTube player fault. Every entry point is wrapped.
 *  - Never force layout. No getBoundingClientRect, no offsetParent - this script runs across the watch
 *    page's boot, which is the most timing-sensitive window on the page.
 */

import {
  BRIDGE_CHANNEL,
  MAX_RATE,
  MAX_VOLUME,
  MIN_RATE,
  MIN_VOLUME,
  decode,
  isPlayerKind,
  isQualityLevel,
  send,
  type BridgeCommand,
  type PlayerKind,
} from '../bridge/protocol'
import type { QualityLevel } from '../../types/settings'
import { initVolumeDiag } from './volumeDiag'

interface PlayerApi extends HTMLElement {
  setPlaybackQualityRange?: (min: QualityLevel, max: QualityLevel) => void
  setPlaybackRate?: (rate: number) => void
  setVolume?: (volume: number) => void
  getVolume?: () => number
  isMuted?: () => boolean
  unMute?: () => void
}

const RETRY_INTERVAL_MS = 250
const RETRY_ATTEMPTS = 40

/**
 * Identifies this MAIN-world instance so that two installed copies of this extension (the normal state
 * while developing: an unpacked build plus a store build) do not execute each other's commands. Each
 * ISOLATED side latches the first token it sees and tags its commands with it; we ignore anything
 * carrying a different one. It is a routing tag between our own scripts, not authentication - the page
 * can read it and forge it, which is fine, because every op here is something the page could do anyway.
 */
const INSTANCE_TOKEN = Math.random().toString(36).slice(2) + Date.now().toString(36)

/** The last value asked for, per player kind. Re-applied whenever the media element reloads. */
interface Desired {
  quality?: QualityLevel
  rate?: number
}
const desired = new Map<PlayerKind, Desired>()

interface PendingRetry {
  attempts: number
  timer: number
  /** Kept so a superseded command still gets an authoritative answer instead of stranding its caller. */
  onSettled?: (applied: boolean, value: number | null) => void
}
const retries = new Map<string, PendingRetry>()

function selectorFor(kind: PlayerKind): string {
  return kind === 'shorts' ? '#shorts-player' : '#movie_player'
}

/**
 * Resolves the live player without touching layout.
 *
 * YouTube's SPA keeps a previous page's player mounted, so several nodes can match. Rather than
 * measuring visibility, prefer a candidate whose media element has actually loaded something - and
 * since we are in the MAIN world, "does it expose the API" is itself a usable discriminator.
 */
function resolvePlayer(kind: PlayerKind): PlayerApi | null {
  const candidates = Array.from(document.querySelectorAll<PlayerApi>(selectorFor(kind)))
  // setVolume is in the list because the volume ops do not need the other two, and a player that
  // exposed only setVolume would otherwise be filtered out and reported as "no player".
  const usable = candidates.filter(
    (el) =>
      typeof el.setPlaybackRate === 'function' ||
      typeof el.setPlaybackQualityRange === 'function' ||
      typeof el.setVolume === 'function'
  )
  return usable.find((el) => Boolean(el.querySelector('video')?.currentSrc)) ?? usable[0] ?? null
}

/**
 * Returns true only if a player method was actually found and called without throwing.
 *
 * Never throws. These are calls into YouTube's own minified code at an arbitrary point in its
 * lifecycle, so they genuinely can throw - and a throw escaping here would both land in YouTube's
 * window 'error' handler (which feeds their player error telemetry) and leave the caller's retry
 * bookkeeping wedged with no response ever sent.
 */
function applyCommand(cmd: BridgeCommand, out: { value: number | null }): boolean {
  try {
    const player = resolvePlayer(cmd.player)
    if (!player) return false

    /**
     * Volume goes through the player's own API, never through video.volume.
     *
     * This is not a style preference, it is the whole point. Writing the media element directly does
     * change the audio, but YouTube's player keeps its own volume model and re-asserts it onto the
     * element on its periodic heartbeat - observed in the wild as `heartbeat.js onSuccess` ->
     * `setVolume` -> `video.volume = 0.05`, stamping YouTube's remembered value back over the user's
     * roughly once a minute. Going through setVolume updates that model, so the heartbeat re-asserts
     * the value we set instead of fighting it, and YouTube persists it for the next video for free.
     */
    if (cmd.op === 'setVolume' || cmd.op === 'adjustVolume') {
      if (typeof player.setVolume !== 'function') return false

      let target: number
      if (cmd.op === 'setVolume') {
        target = cmd.volume
      } else {
        // Read-modify-write in one synchronous step. getVolume is the player's own number, which is
        // the only value the wheel can safely add to - the media element's is on a different scale
        // and is whatever the last heartbeat happened to leave behind.
        if (typeof player.getVolume !== 'function') return false
        const current = player.getVolume()
        if (typeof current !== 'number' || !Number.isFinite(current)) return false
        target = current + cmd.delta
      }

      const clamped = Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, Math.round(target)))
      player.setVolume(clamped)

      // Only the wheel path may unmute, and only when turning up. Unmuting from the default-volume
      // path would override a mute the user deliberately set, on every single video load.
      if (cmd.op === 'adjustVolume' && cmd.unmute && clamped > 0 && player.isMuted?.() === true) {
        player.unMute?.()
      }

      // Read back rather than reporting `clamped`: the indicator should show what the player ended up
      // at, not what we asked for, so a rejected or adjusted write cannot show a number that is a lie.
      const readBack = typeof player.getVolume === 'function' ? player.getVolume() : clamped
      out.value = typeof readBack === 'number' && Number.isFinite(readBack) ? readBack : clamped
      return true
    }

    if (cmd.op === 'setQuality') {
      if (typeof player.setPlaybackQualityRange !== 'function') return false
      // 'auto' is sent through rather than short-circuited. It is a real operand, and it is the only
      // way to release a quality we previously forced: skipping it left the player pinned at the last
      // forced level, and YouTube's own yt-player-quality preference holding it for every later video.
      // Returning true without calling anything also reported success for a write that never happened,
      // which is the exact failure shape this bridge exists to eliminate.
      player.setPlaybackQualityRange(cmd.quality, cmd.quality)
      return true
    }

    if (typeof player.setPlaybackRate !== 'function') return false
    player.setPlaybackRate(cmd.rate)
    return true
  } catch (error) {
    console.debug('[ytimprover] player call threw', error)
    return false
  }
}

function retryKey(cmd: BridgeCommand): string {
  return `${cmd.player}:${cmd.op}`
}

/**
 * Drops a retry track, answering its caller first.
 *
 * Commands are keyed by player+op, so a newer command for the same slot supersedes an in-flight one.
 * Without the onSettled call below, that older command's promise on the ISOLATED side would never
 * receive its authoritative response and would hang for the full command timeout before resolving
 * false - which in turn blocks the caller from committing its "already applied" key.
 */
function cancelRetry(key: string): void {
  const pending = retries.get(key)
  if (!pending) return
  clearTimeout(pending.timer)
  retries.delete(key)
  pending.onSettled?.(false, null)
}

/**
 * Runs a command, retrying while the player has not mounted yet.
 *
 * `onSettled` fires once, with whether a real write landed. The ISOLATED side only commits its
 * "already applied" bookkeeping on a true here, so a page that never produces a player leaves the
 * feature eligible to retry on the next navigation instead of being silently marked done.
 */
function runCommand(
  cmd: BridgeCommand,
  onSettled?: (applied: boolean, value: number | null) => void
): { applied: boolean; value: number | null } {
  const key = retryKey(cmd)
  cancelRetry(key)

  const out: { value: number | null } = { value: null }
  if (applyCommand(cmd, out)) {
    onSettled?.(true, out.value)
    return { applied: true, value: out.value }
  }

  const attempt = (): void => {
    const pending = retries.get(key)
    if (!pending) return
    const retryOut: { value: number | null } = { value: null }
    if (applyCommand(cmd, retryOut)) {
      retries.delete(key)
      onSettled?.(true, retryOut.value)
      return
    }
    pending.attempts += 1
    if (pending.attempts >= RETRY_ATTEMPTS) {
      retries.delete(key)
      onSettled?.(false, null)
      return
    }
    pending.timer = window.setTimeout(attempt, RETRY_INTERVAL_MS)
  }

  retries.set(key, { attempts: 0, timer: window.setTimeout(attempt, RETRY_INTERVAL_MS), onSettled })
  return { applied: false, value: null }
}

/**
 * Records what to re-assert on the next media load.
 *
 * 'auto' deliberately DELETES the remembered quality rather than storing it. Storing it would be
 * harmless on its own, but forgetting to clear it means switching the setting back to "auto" leaves
 * the previously forced quality being re-applied on every subsequent clip, with no way for the user
 * to get YouTube's own adaptive selection back short of reloading.
 */
function remember(cmd: BridgeCommand): void {
  const current = desired.get(cmd.player) ?? {}
  if (cmd.op === 'setQuality') {
    if (cmd.quality === 'auto') delete current.quality
    else current.quality = cmd.quality
  } else if (cmd.op === 'setPlaybackRate') {
    current.rate = cmd.rate
  }
  // Volume is deliberately NOT remembered, and this must stay an explicit op check rather than an
  // `else`. YouTube persists volume itself once it is set through setVolume, so re-asserting on every
  // media load would fight the user's own slider for the rest of the session. An `else` here would
  // also have written `current.rate = undefined` on every volume command, silently wiping a
  // remembered playback speed.
  desired.set(cmd.player, current)
}

/**
 * Re-applies the remembered settings whenever a media element starts loading.
 *
 * `loadstart` does not bubble, but the capture phase still visits every ancestor on the way down to
 * the target, so one document-level capture listener covers every <video> the page ever creates -
 * including the pooled elements YouTube recycles between clips, which is why binding to a specific
 * element would go stale.
 *
 * This is verified working, not assumed: with a default playback speed set, a value written during
 * player boot was observed being re-asserted here when YouTube attached the stream.
 *
 * It is NOT sufficient on its own for Shorts, where a gapless transition can start the next clip
 * without a fresh loadstart. The ISOLATED side covers that by re-sending on each SPA navigation.
 */
function onMediaEvent(event: Event): void {
  try {
    const media = event.target
    if (!(media instanceof HTMLVideoElement)) return

    for (const [kind, want] of desired) {
      // Only re-apply to the player this media element actually belongs to. Watch and Shorts players
      // can both be mounted at once, so an unscoped re-apply would write one surface's settings onto
      // the other's player whenever either one loaded.
      const player = resolvePlayer(kind)
      if (!player || !player.contains(media)) continue
      // Applied directly rather than via runCommand: there is a player right here, so there is
      // nothing to wait for, and a retry budget would only burn timers.
      const out: { value: number | null } = { value: null }
      if (want.quality !== undefined) applyCommand({ op: 'setQuality', player: kind, quality: want.quality }, out)
      if (want.rate !== undefined) applyCommand({ op: 'setPlaybackRate', player: kind, rate: want.rate }, out)
    }
  } catch (error) {
    console.debug('[ytimprover] media-event re-apply failed', error)
  }
}

/** Re-validates and clamps every operand. Never trusts the sender - see invariant 1 in protocol.ts. */
function sanitize(raw: unknown): BridgeCommand | null {
  if (!raw || typeof raw !== 'object') return null
  const cmd = raw as {
    op?: unknown
    player?: unknown
    quality?: unknown
    rate?: unknown
    volume?: unknown
    delta?: unknown
    unmute?: unknown
  }
  if (!isPlayerKind(cmd.player)) return null

  if (cmd.op === 'setQuality') {
    return isQualityLevel(cmd.quality) ? { op: 'setQuality', player: cmd.player, quality: cmd.quality } : null
  }
  if (cmd.op === 'setPlaybackRate') {
    if (typeof cmd.rate !== 'number' || !Number.isFinite(cmd.rate)) return null
    const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, cmd.rate))
    return { op: 'setPlaybackRate', player: cmd.player, rate }
  }
  if (cmd.op === 'setVolume') {
    if (typeof cmd.volume !== 'number' || !Number.isFinite(cmd.volume)) return null
    const volume = Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, Math.round(cmd.volume)))
    return { op: 'setVolume', player: cmd.player, volume }
  }
  if (cmd.op === 'adjustVolume') {
    if (typeof cmd.delta !== 'number' || !Number.isFinite(cmd.delta)) return null
    // Clamped to the full range rather than to a step size: the operand is a delta, and the result is
    // clamped to 0-100 on application anyway, so a large value can only saturate - never escape.
    const delta = Math.min(MAX_VOLUME, Math.max(-MAX_VOLUME, Math.round(cmd.delta)))
    return { op: 'adjustVolume', player: cmd.player, delta, unmute: cmd.unmute === true }
  }
  return null
}

function onBridgeMessage(event: Event): void {
  try {
    const message = decode((event as CustomEvent).detail)
    if (!message) return

    if (message.dir === 'hello') {
      send({ dir: 'ready', token: INSTANCE_TOKEN })
      return
    }

    if (message.dir !== 'cmd') return
    // Not ours: another installed copy of this extension is driving its own MAIN script
    if (message.token !== INSTANCE_TOKEN) return

    if (typeof message.client !== 'string') return
    const id = message.id
    const client = message.client

    const cmd = sanitize(message.cmd)
    if (!cmd) {
      // Answered rather than dropped. An unanswered command strands its caller for the full timeout,
      // never commits, and is then re-sent on every navigation for the life of the tab - silently.
      console.debug('[ytimprover] rejected malformed bridge command', message.cmd)
      send({ dir: 'res', id, token: INSTANCE_TOKEN, client, applied: false, pending: false, value: null })
      return
    }

    remember(cmd)
    let settled = false
    const result = runCommand(cmd, (ok, value) => {
      // Second, authoritative answer once a retried command finally lands, gives up, or is superseded
      if (settled) {
        send({ dir: 'res', id, token: INSTANCE_TOKEN, client, applied: ok, pending: false, value })
      }
    })
    settled = true
    send({
      dir: 'res',
      id,
      token: INSTANCE_TOKEN,
      client,
      applied: result.applied,
      pending: !result.applied,
      value: result.value,
    })
  } catch (error) {
    console.debug('[ytimprover] bridge message failed', error)
  }
}

try {
  // First, so its `volume` setter patch is installed before YouTube's player bundle loads and starts
  // writing. Inert unless localStorage['ytimprover-diag'] === '1'. Temporary - see ../diag/channel.ts.
  initVolumeDiag()

  document.addEventListener(BRIDGE_CHANNEL, onBridgeMessage)
  document.addEventListener('loadstart', onMediaEvent, true)
  // Announce unconditionally: if the ISOLATED script is not listening yet it will send `hello` and we
  // answer that instead, so injection order between the two scripts does not matter.
  send({ dir: 'ready', token: INSTANCE_TOKEN })
} catch (error) {
  console.debug('[ytimprover] bridge setup failed', error)
}
