import type { QualityLevel } from '../../types/settings'

/**
 * Wire protocol for the ISOLATED <-> MAIN world player bridge.
 *
 * WHY THIS EXISTS
 * ---------------
 * YouTube attaches its imperative player API (setPlaybackQualityRange, setPlaybackRate, ...) onto the
 * #movie_player / #shorts-player DOM element as plain own properties, from the page's own JavaScript.
 * Chrome gives every isolated world its own V8 wrapper per DOM node, so those properties do not exist
 * for a content script in the ISOLATED world. The element is shared; the expandos are not.
 *
 * This was confirmed empirically, not assumed: a probe running inside this extension's own content
 * script reported `typeof player.getPlayerState === 'undefined'` on both a watch page and a Short,
 * while the same expression in the page-world console reported 'function'. Before that probe, default
 * video quality, default playback speed and default Shorts quality had never applied for anyone.
 *
 * SECURITY MODEL - read this before adding an op.
 * -----------------------------------------------
 * The MAIN-world script shares an execution context with youtube.com's own JavaScript. It has NO
 * privilege boundary against the page. YouTube, any other page script, and any other extension's
 * MAIN-world script can read this channel, forge messages on it, and monkey-patch our own functions.
 * Nothing sent here is confidential and nothing received here is authenticated.
 *
 * A per-session nonce would NOT change that: the MAIN-world script must keep any nonce in
 * page-readable memory in order to use it, so the page can always read it back. The instance token
 * below exists to pair two of OUR OWN scripts when several copies of this extension are installed at
 * once - it is a routing tag, not a security control. Do not add a nonce and call it security.
 *
 * INVARIANT 1 - the bridge grants the page no capability it does not already have.
 *   Every op is something youtube.com's own code could already do to its own player at any moment.
 *   A forged `setQuality` lets the page set its own video quality, which is not an escalation.
 *   Consequently there is NO generic op: no "call this method by name", no selector taken from the
 *   message, no arbitrary argument forwarding. The op list is closed and the MAIN side re-validates
 *   and clamps every operand rather than trusting the sender.
 *
 * INVARIANT 2 - nothing privileged crosses into the MAIN world.
 *   The MAIN-world script never references chrome.*, never touches storage, and never receives the
 *   Settings object. Only the scalar operands of the operation in hand are sent. Results coming back
 *   must never trigger a storage read or write on the ISOLATED side.
 */

/**
 * Fixed channel name. Distinctive enough not to collide with YouTube's own event traffic or another
 * extension's bridge. Per the security note above, this is namespacing, not authentication.
 */
export const BRIDGE_CHANNEL = 'ytimprover-player-bridge-v1'

export type PlayerKind = 'watch' | 'shorts'

/**
 * Runtime allow-list for quality operands, kept in lockstep with QualityLevel by the Record type:
 * adding a level to QualityLevel without adding it here is a compile error, and vice versa.
 *
 * Declared here rather than imported from types/settings so the MAIN-world bundle never pulls in a
 * module that touches chrome.storage (invariant 2). Only the *type* is imported, and type imports are
 * erased at compile time.
 */
const QUALITY_TABLE: Record<QualityLevel, true> = {
  auto: true,
  highres: true,
  hd2880: true,
  hd2160: true,
  hd1440: true,
  hd1080: true,
  hd720: true,
  large: true,
  medium: true,
  small: true,
  tiny: true,
}

export function isQualityLevel(value: unknown): value is QualityLevel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(QUALITY_TABLE, value)
}

export function isPlayerKind(value: unknown): value is PlayerKind {
  return value === 'watch' || value === 'shorts'
}

/** Mirrors PLAYBACK_SPEEDS in types/settings; re-declared so MAIN does not import that module. */
export const MIN_RATE = 0.25
export const MAX_RATE = 2

export type BridgeCommand =
  | { op: 'setQuality'; player: PlayerKind; quality: QualityLevel }
  | { op: 'setPlaybackRate'; player: PlayerKind; rate: number }

export type BridgeMessage =
  /** MAIN -> ISOLATED: "listener registered", sent on load and in answer to every `hello`. */
  | { dir: 'ready'; token: string }
  /** ISOLATED -> MAIN: "are you there?", for the case where MAIN loaded before we were listening. */
  | { dir: 'hello' }
  /**
   * ISOLATED -> MAIN: perform one player operation.
   *
   * `client` identifies the sending ISOLATED script. With two copies of this extension installed,
   * both clients can latch the same MAIN instance, and their `id` counters both start at 1 - so
   * without this, copy A could match copy B's response to its own command and resolve a promise
   * `applied: true` for a write that was never made on its behalf.
   */
  | { dir: 'cmd'; id: number; token: string; client: string; cmd: BridgeCommand }
  /**
   * MAIN -> ISOLATED: the outcome.
   *
   * `applied` means a player method was found AND called without throwing - not merely that the
   * message was received. The ISOLATED side keys its "already applied" bookkeeping off this, so a
   * handshake alone must never be able to report success. `pending` means no player existed yet and
   * MAIN has scheduled a retry, so the caller should keep waiting rather than treat it as failure.
   */
  | { dir: 'res'; id: number; token: string; client: string; applied: boolean; pending: boolean }

/**
 * The detail is a JSON string rather than an object on purpose.
 *
 * A CustomEvent's `detail` is a V8 value owned by the world that created it; Blink structured-clones
 * it when the other world reads it, which throws on anything non-cloneable and quietly changes object
 * identity. A string sidesteps that entirely and guarantees only inert data crosses - it cannot carry
 * a function or a live reference between worlds.
 */
export function encode(message: BridgeMessage): string {
  return JSON.stringify(message)
}

export function decode(detail: unknown): BridgeMessage | null {
  if (typeof detail !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(detail)
    if (!parsed || typeof parsed !== 'object') return null
    const dir = (parsed as { dir?: unknown }).dir
    if (dir !== 'cmd' && dir !== 'hello' && dir !== 'ready' && dir !== 'res') return null
    return parsed as BridgeMessage
  } catch {
    return null
  }
}

export function send(message: BridgeMessage): void {
  document.dispatchEvent(new CustomEvent(BRIDGE_CHANNEL, { detail: encode(message) }))
}
