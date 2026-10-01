import {
  BRIDGE_CHANNEL,
  decode,
  send,
  type BridgeCommand,
  type BridgeMessage,
} from './protocol'

/**
 * ISOLATED-world client for the player bridge.
 *
 * Feature modules call `sendPlayerCommand` and await the result. The promise resolves true only when
 * the MAIN-world script reports that it actually found a player and called a method on it, so callers
 * can safely use it to decide whether to commit their "already applied" bookkeeping.
 */

/** Long enough to cover MAIN's own retry budget (40 x 250ms) plus slack. */
const COMMAND_TIMEOUT_MS = 15000
const READY_WARN_MS = 5000

/**
 * Distinguishes this ISOLATED client from another installed copy of the extension. Both copies can
 * latch the same MAIN instance and both number their commands from 1, so responses must be routed by
 * client as well as by id - otherwise one copy resolves the other's response as its own.
 */
const CLIENT_ID = Math.random().toString(36).slice(2) + Date.now().toString(36)

let token: string | null = null
let nextId = 1
let listening = false
let warnedUnavailable = false

/** What a command settles to. `value` is the player reading for ops that produce one, else null. */
export interface PlayerResult {
  applied: boolean
  value: number | null
}

interface PendingCommand {
  resolve: (result: PlayerResult) => void
  timer: number
}
const pending = new Map<number, PendingCommand>()

/**
 * Commands issued before MAIN announced itself, replayed once it does.
 *
 * Entries carry their own timeout so that a MAIN script which never appears (Chrome below 111, or an
 * injection the browser refused) settles them false rather than leaving every caller's promise
 * unresolved and the queue growing for the life of the page.
 */
interface QueuedCommand {
  cmd: BridgeCommand
  resolve: (result: PlayerResult) => void
  timer: number
}
let queue: QueuedCommand[] = []

function settle(id: number, result: PlayerResult): void {
  const entry = pending.get(id)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(id)
  entry.resolve(result)
}

function dispatch(cmd: BridgeCommand, resolve: (result: PlayerResult) => void): void {
  if (token === null) {
    const entry: QueuedCommand = {
      cmd,
      resolve,
      timer: window.setTimeout(() => {
        queue = queue.filter((q) => q !== entry)
        resolve({ applied: false, value: null })
      }, COMMAND_TIMEOUT_MS),
    }
    queue.push(entry)
    return
  }
  const id = nextId++
  const timer = window.setTimeout(() => settle(id, { applied: false, value: null }), COMMAND_TIMEOUT_MS)
  pending.set(id, { resolve, timer })
  send({ dir: 'cmd', id, token, client: CLIENT_ID, cmd })
}

function onMessage(event: Event): void {
  const message: BridgeMessage | null = decode((event as CustomEvent).detail)
  if (!message) return

  if (message.dir === 'ready') {
    if (token === null) {
      token = message.token
      const waiting = queue
      queue = []
      for (const item of waiting) {
        clearTimeout(item.timer)
        dispatch(item.cmd, item.resolve)
      }
    } else if (token !== message.token) {
      // Two copies of this extension are installed (commonly an unpacked dev build alongside a store
      // build). Each pair talks past the other and settings will appear to fight. Worth saying out
      // loud, because the symptom - values flickering between two settings - looks like a code bug.
      console.warn(
        '[ytimprover] a second player bridge announced itself. Another copy of this extension is ' +
          'probably installed; disable one at chrome://extensions or their settings will conflict.'
      )
    }
    return
  }

  // Both guards matter: token rejects another MAIN instance, client rejects a response addressed to
  // another installed copy of this extension that happens to share the same id counter
  if (message.dir !== 'res' || message.token !== token || message.client !== CLIENT_ID) return
  // A `pending` response means MAIN has not given up yet - keep waiting for the authoritative answer
  if (message.pending) return
  settle(message.id, { applied: message.applied, value: message.value ?? null })
}

function ensureListening(): void {
  if (listening) return
  listening = true
  document.addEventListener(BRIDGE_CHANNEL, onMessage)
  // MAIN may have loaded and announced before this listener existed, so ask again
  send({ dir: 'hello' })

  window.setTimeout(() => {
    if (token !== null || warnedUnavailable) return
    warnedUnavailable = true
    console.warn(
      '[ytimprover] the MAIN-world player bridge never responded, so default quality and playback ' +
        'speed cannot be applied. This needs Chrome 111+ for the manifest "world" key.'
    )
  }, READY_WARN_MS)
}

/** Resolves true only once a player method was actually called. */
export function sendPlayerCommand(cmd: BridgeCommand): Promise<boolean> {
  return sendPlayerCommandForResult(cmd).then((result) => result.applied)
}

/**
 * As sendPlayerCommand, but also hands back the reading the player produced.
 *
 * Separate from sendPlayerCommand so existing callers that only care whether the write landed keep
 * their simple boolean, and so a caller that needs the number cannot forget to check `applied` first -
 * `value` is meaningless when the command never reached a player.
 */
export function sendPlayerCommandForResult(cmd: BridgeCommand): Promise<PlayerResult> {
  ensureListening()
  return new Promise<PlayerResult>((resolve) => dispatch(cmd, resolve))
}

export function initPlayerBridge(): void {
  ensureListening()
}
