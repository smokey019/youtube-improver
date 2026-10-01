/**
 * MAIN-world half of the volume diagnostic. TEMPORARY - see ../diag/channel.ts.
 *
 * WHY IT HAS TO BE HERE AND NOT IN THE CONSOLE
 * --------------------------------------------
 * The authoritative volume number is `player.getVolume()`, and that method is a page-world expando the
 * isolated content script cannot see at all (../bridge/protocol.ts). Typing the same expression into
 * DevTools does not settle anything either: the console evaluates in the page world by default, so it
 * reports capabilities the extension does not have. The probe has to run where the code under test runs.
 *
 * WHAT IT IS FOR
 * --------------
 * The volume collapses to roughly 5% during normal use. The candidate explanations each predict a
 * different pair of numbers, so the probe records BOTH sides at every event:
 *   - YouTube's internal percentage, player.getVolume()  (0-100)
 *   - the raw media element value, video.volume          (0-1)
 * If getVolume() reports 15 while video.volume is 0.05, YouTube and the element have diverged and a
 * scale mismatch is in play. If they agree at 5, something genuinely wrote 5 and the only question left
 * is who.
 *
 * WHO WROTE IT is answered by patching the `volume` setter. Chrome gives every world its own copy of the
 * DOM prototypes, so a patch installed here intercepts ONLY page-world writes - which is to say, only
 * YouTube's. The extension's own writes come from the isolated world and are caught by the twin patch
 * over there. That split attributes every change to a world instead of guessing from timing.
 *
 * RULES (inherited from index.ts - this file shares youtube.com's execution context):
 *  - No chrome.*, no storage, no eval, no injection.
 *  - Never throw into the page. YouTube's window 'error' handler feeds its player telemetry.
 *  - No forced layout. No getBoundingClientRect, no offsetParent - the watch page boot is the most
 *    timing-sensitive window on the page, and the probe must not become the thing it is measuring.
 */

import { DIAG_CHANNEL, diagEnabled, type DiagRecord } from '../diag/channel'

const MAX_RECORDS = 4000
/** Cheap enough to run continuously, fast enough to catch a change between two player events. */
const DRIFT_POLL_MS = 400
/** A volumechange this soon after a setter call came from that call. */
const ATTRIBUTION_WINDOW_MS = 60

interface PlayerProbe extends HTMLElement {
  getVolume?: () => number
  isMuted?: () => boolean
  getPlayerState?: () => number
}

const records: DiagRecord[] = []

/** Most recent write to any media element volume, either world, for attributing volumechange events. */
let lastWrite: { world: string; value: number; t: number; stack: string } | null = null

function now(): number {
  return Math.round(performance.now())
}

function push(kind: string, data?: Record<string, unknown>): void {
  records.push({ t: now(), world: 'page', kind, data })
  // Drop from the front rather than stopping: the interesting moment is the collapse, which comes late.
  if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS)
}

/**
 * Trims the stack to the frames that identify the caller.
 *
 * The top frames are always this file's own setter, which says nothing. What matters is the frame below
 * it: YouTube's minified player bundle (base.js / player_ias) versus anything else.
 */
function callerStack(): string {
  const raw = new Error().stack ?? ''
  return raw
    .split('\n')
    .slice(2, 8)
    .map((line) => line.trim().replace(/^at\s+/, ''))
    .filter(Boolean)
    .join(' <- ')
}

function shortSrc(value: string): string {
  if (!value) return ''
  if (value.startsWith('blob:')) return 'blob:...' + value.slice(-12)
  return value.slice(0, 48)
}

function findPlayer(): PlayerProbe | null {
  // querySelector only. Deliberately not the feature's visibility check, which measures and so forces
  // layout - and which is itself one of the things under suspicion.
  return (
    document.querySelector<PlayerProbe>('#movie_player') ??
    document.querySelector<PlayerProbe>('#shorts-player')
  )
}

interface VideoSnapshot {
  vol: number
  muted: boolean
  readyState: number
  paused: boolean
  inPlayer: boolean
  src: string
}

interface Snapshot {
  href: string
  apiVolume: number | null
  apiMuted: boolean | null
  playerState: number | null
  adShowing: boolean | null
  videoCount: number
  videos: VideoSnapshot[]
  ytStored: string | null
}

/**
 * One reading of every number that could explain the collapse.
 *
 * EVERY <video> on the page is listed, not just the first one inside the player. The volume feature
 * reads `player.querySelector('video')` - the FIRST match - so if the page ever holds more than one,
 * knowing which of them sits at 0.05 and which one is actually audible is the whole answer.
 */
function snapshot(): Snapshot {
  const player = findPlayer()
  const videos = Array.from(document.querySelectorAll('video'))

  let apiVolume: number | null = null
  let apiMuted: boolean | null = null
  let playerState: number | null = null
  try {
    // The expandos the isolated world cannot reach. Their absence HERE means the player has not booted
    // yet, which is itself worth recording rather than silently reading as zero.
    apiVolume = typeof player?.getVolume === 'function' ? player.getVolume() : null
    apiMuted = typeof player?.isMuted === 'function' ? player.isMuted() : null
    playerState = typeof player?.getPlayerState === 'function' ? player.getPlayerState() : null
  } catch {
    // Calls into YouTube's minified code mid-boot genuinely can throw; a failed reading is not a failed
    // probe, and must not surface as a page error.
  }

  let ytStored: string | null = null
  try {
    ytStored = localStorage.getItem('yt-player-volume')
  } catch {
    ytStored = null
  }

  return {
    href: location.href,
    apiVolume,
    apiMuted,
    playerState,
    adShowing: player ? player.classList.contains('ad-showing') : null,
    videoCount: videos.length,
    videos: videos.map((v) => ({
      vol: Number(v.volume.toFixed(4)),
      muted: v.muted,
      readyState: v.readyState,
      paused: v.paused,
      inPlayer: player ? player.contains(v) : false,
      src: shortSrc(v.currentSrc),
    })),
    ytStored,
  }
}

function record(kind: string, extra?: Record<string, unknown>): void {
  push(kind, { ...snapshot(), ...extra })
}

/**
 * Decodes YouTube's remembered volume.
 *
 * The entry is doubly encoded - a JSON envelope whose `data` field is itself a JSON string - so reading
 * it raw shows an escaped blob rather than a number.
 */
function ytRemembered(): unknown {
  try {
    const raw = localStorage.getItem('yt-player-volume')
    if (!raw) return null
    const envelope: unknown = JSON.parse(raw)
    const data = (envelope as { data?: unknown }).data
    return typeof data === 'string' ? JSON.parse(data) : envelope
  } catch {
    return 'unreadable'
  }
}

/**
 * Intercepts page-world writes to video.volume and video.muted.
 *
 * Installed at document_start, before YouTube's player bundle loads, so the player's own writes go
 * through it. The original descriptor is always called afterwards: the probe observes, it never alters
 * the behaviour it is there to describe.
 */
function patchMediaVolume(): void {
  const proto = HTMLMediaElement.prototype

  const volumeDesc = Object.getOwnPropertyDescriptor(proto, 'volume')
  if (volumeDesc?.get && volumeDesc.set) {
    const get = volumeDesc.get
    const set = volumeDesc.set
    Object.defineProperty(proto, 'volume', {
      configurable: true,
      enumerable: volumeDesc.enumerable,
      get(this: HTMLMediaElement): number {
        return get.call(this) as number
      },
      set(this: HTMLMediaElement, value: number) {
        try {
          const from = Number((get.call(this) as number).toFixed(4))
          const stack = callerStack()
          lastWrite = { world: 'page', value, t: now(), stack }
          push('write.volume', { from, to: value, by: 'page(youtube)', stack })
          observeVolume(value, 'page(youtube)', stack, this)
        } catch {
          // Instrumentation must never break the write itself.
        }
        set.call(this, value)
      },
    })
  }

  const mutedDesc = Object.getOwnPropertyDescriptor(proto, 'muted')
  if (mutedDesc?.get && mutedDesc.set) {
    const get = mutedDesc.get
    const set = mutedDesc.set
    Object.defineProperty(proto, 'muted', {
      configurable: true,
      enumerable: mutedDesc.enumerable,
      get(this: HTMLMediaElement): boolean {
        return get.call(this) as boolean
      },
      set(this: HTMLMediaElement, value: boolean) {
        try {
          push('write.muted', { to: value, by: 'page(youtube)', stack: callerStack() })
        } catch {
          // observe only
        }
        set.call(this, value)
      },
    })
  }
}

/**
 * Collapse detection.
 *
 * The probe was originally a timeline you had to read and interpret. That is the wrong shape for an
 * intermittent fault: by the time anyone thinks to look, the interesting moment is hundreds of rows
 * back, and knowing which rows matter requires already knowing the answer. So the probe watches for
 * the event itself - a real drop to a low volume - and prints its own verdict the moment it happens.
 *
 * "Real drop" is deliberately narrow. Muting, and the ordinary ramp down to zero when a clip ends, both
 * produce low values without being this bug.
 */
const COLLAPSE_LANDS_AT = 0.12
const COLLAPSE_FALLS_FROM = 0.2

interface CollapseReport {
  t: number
  from: number
  to: number
  by: string
  stack: string | null
  apiVolume: number | null
  apiVsElement: string
  webAudioInUse: boolean
  ytRemembered: unknown
  videoCount: number
  recentKinds: string[]
  verdict: string
}

const collapses: CollapseReport[] = []
let previousVolume: number | null = null
const seenMedia = new WeakSet<HTMLMediaElement>()

/**
 * Names the most likely explanation from the shape of the drop.
 *
 * Each branch corresponds to a mechanism that predicts a different observable, so the branch that
 * fires IS the discriminating result - there is nothing further to weigh up by hand.
 */
function verdictFor(from: number, to: number, by: string, apiVolume: number | null): string {
  const element = Math.round(to * 100)

  if (by.startsWith('ext')) {
    if (from <= 0.005) {
      return (
        'EXTENSION wrote it, starting from a zero anchor. readVolume returned 0 (not null, so the ' +
        'current === null guard did not fire) and one notch added wheelVolumeStep: 0 + 5 = 5.'
      )
    }
    if (from - to > 0.25) {
      return (
        'EXTENSION wrote it as one huge downward step. volumePointsFromWheel has no magnitude ceiling, ' +
        'so a single high-delta wheel event bottomed the volume out and Math.max(0, ...) hid the overshoot.'
      )
    }
    return 'EXTENSION wrote it, as an ordinary-sized step from a healthy value. Unexpected - check the stack.'
  }

  if (by.startsWith('page')) {
    if (apiVolume !== null && Math.abs(apiVolume - element) > 3) {
      return (
        'YOUTUBE wrote it, and its internal volume (' +
        String(apiVolume) +
        ') disagrees with the element (' +
        String(element) +
        '). A scale or gain conversion sits between the two.'
      )
    }
    return (
      'YOUTUBE wrote it, and its internal volume agrees with the element. It is restoring its own ' +
      'remembered number. The extension sets volume through the player API, so compare against ' +
      'ytRemembered below to see whether the remembered value itself is what is low.'
    )
  }

  return (
    'UNATTRIBUTED - nothing assigned to video.volume in either world, so the media element was ' +
    'swapped or re-created rather than written to.'
  )
}

/**
 * One reading of the volume, from whichever path observed it. Fires the report on a genuine collapse.
 *
 * Every write path funnels through here rather than each testing for itself, so an unattributed change
 * - the most informative outcome - is caught on exactly the same terms as an attributed one.
 */
function observeVolume(to: number, by: string, stack: string | null, media?: HTMLMediaElement): void {
  // A media element's first write is YouTube initialising a new player: the element starts at its default
  // 100% and YouTube sets its remembered volume. That is construction, not a collapse, and it also fires
  // on pages with no playback (feeds build a player for hover previews).
  if (media && !seenMedia.has(media)) {
    seenMedia.add(media)
    previousVolume = to
    return
  }
  const from = previousVolume
  previousVolume = to
  if (from === null || from < COLLAPSE_FALLS_FROM || to > COLLAPSE_LANDS_AT) return

  const snap = snapshot()
  const element = Math.round(to * 100)
  const report: CollapseReport = {
    t: now(),
    from: Number(from.toFixed(4)),
    to: Number(to.toFixed(4)),
    by,
    stack,
    apiVolume: snap.apiVolume,
    apiVsElement:
      snap.apiVolume === null
        ? 'player API not readable'
        : 'youtube=' + String(snap.apiVolume) + ' element=' + String(element),
    webAudioInUse,
    ytRemembered: ytRemembered(),
    videoCount: snap.videoCount,
    recentKinds: records.slice(-15).map((r) => r.kind),
    verdict: verdictFor(from, to, by, snap.apiVolume),
  }
  collapses.push(report)
  push('COLLAPSE', report as unknown as Record<string, unknown>)

  console.warn(
    '[ytimprover:diag] COLLAPSE #' +
      String(collapses.length) +
      ': ' +
      String(Math.round(from * 100)) +
      '% -> ' +
      String(element) +
      '% (' +
      by +
      ')\n' +
      report.verdict +
      '\nRun copy(__ytimproverDiag.report()) and paste the result.',
    report
  )
}

/**
 * Web Audio instrumentation - the probe's one blind spot, closed.
 *
 * Everything above watches `video.volume`. If YouTube attenuates through a Web Audio GainNode instead
 * (which is how loudness normalisation / "Stable Volume" would be implemented), the loss happens
 * DOWNSTREAM of that property: the element would read a healthy 0.5 while the audio is quiet, and the
 * volume-setter trace would show nothing at all. Without this, that outcome is indistinguishable from
 * "nothing is wrong", which is the worst thing a diagnostic can report.
 *
 * So: record whether the media element is routed through Web Audio at all, and what gain is applied.
 * If `webaudio.createMediaElementSource` never appears, this whole explanation is dead and the answer
 * is in the element property after all.
 */
let webAudioInUse = false
let gainRecords = 0
/** Generous enough to show a ramp, low enough that an automated ramp cannot flood the buffer. */
const MAX_GAIN_RECORDS = 200

function patchWebAudio(): void {
  const protos: BaseAudioContext['constructor']['prototype'][] = []
  if (typeof AudioContext !== 'undefined') protos.push(AudioContext.prototype)
  const webkit = (window as unknown as { webkitAudioContext?: { prototype: object } }).webkitAudioContext
  if (webkit?.prototype) protos.push(webkit.prototype)

  for (const proto of protos) {
    const ctx = proto as unknown as {
      createMediaElementSource?: (el: HTMLMediaElement) => MediaElementAudioSourceNode
    }
    const original = ctx.createMediaElementSource
    if (typeof original !== 'function') continue
    ctx.createMediaElementSource = function patched(
      this: BaseAudioContext,
      el: HTMLMediaElement
    ): MediaElementAudioSourceNode {
      webAudioInUse = true
      push('webaudio.createMediaElementSource', {
        stack: callerStack(),
        elementVolume: Number(el.volume.toFixed(4)),
      })
      return original.call(this, el)
    }
  }

  // Patched on the prototype rather than per node: YouTube creates gain nodes long after this runs,
  // and there is no reliable moment at which to enumerate them.
  const valueDesc = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value')
  if (valueDesc?.get && valueDesc.set) {
    const get = valueDesc.get
    const set = valueDesc.set
    Object.defineProperty(AudioParam.prototype, 'value', {
      configurable: true,
      enumerable: valueDesc.enumerable,
      get(this: AudioParam): number {
        return get.call(this) as number
      },
      set(this: AudioParam, value: number) {
        try {
          // Only once the media element is known to be in a Web Audio graph, otherwise every unrelated
          // AudioParam on the page (YouTube uses them for other things) drowns the signal.
          if (webAudioInUse && gainRecords < MAX_GAIN_RECORDS) {
            gainRecords += 1
            push('webaudio.gain', { to: Number(value.toFixed(4)), stack: callerStack() })
          }
        } catch {
          // observe only
        }
        set.call(this, value)
      },
    })
  }
}

/**
 * Attributes a volumechange to whichever world wrote last.
 *
 * A volumechange with NO recent setter call in either world is the most informative outcome this probe
 * can produce: the value moved without anyone assigning to `volume`, which points at the media element
 * being swapped or re-created rather than written to.
 */
function onVolumeChange(event: Event): void {
  const media = event.target
  if (!(media instanceof HTMLMediaElement)) return
  const recent = lastWrite && now() - lastWrite.t < ATTRIBUTION_WINDOW_MS ? lastWrite : null
  record('event.volumechange', {
    attributedTo: recent ? recent.world : 'UNATTRIBUTED(no setter call)',
    writerStack: recent ? recent.stack : null,
  })
  // Only when no setter fired in either world: the setter paths already reported themselves, and
  // double-reporting would consume previousVolume and mask the next real drop.
  if (!recent) observeVolume(media.volume, 'UNATTRIBUTED(no setter call)', null)
}

function onMediaEvent(event: Event): void {
  if (!(event.target instanceof HTMLMediaElement)) return
  record('event.' + event.type)
}

function onPageEvent(event: Event): void {
  record('yt.' + event.type)
}

/**
 * Catches changes that no event announced.
 *
 * Only the numbers that matter go into the fingerprint, so a quiet page produces no records at all and
 * the log stays readable across a long watch session.
 */
function startDriftWatch(): void {
  let previous = ''
  window.setInterval(() => {
    try {
      const snap = snapshot()
      const fingerprint = JSON.stringify([
        snap.apiVolume,
        snap.apiMuted,
        snap.videos.map((v) => [v.vol, v.muted]),
        snap.adShowing,
        snap.href,
      ])
      if (fingerprint === previous) return
      previous = fingerprint
      push('drift', snap as unknown as Record<string, unknown>)
    } catch {
      // A failed poll is not worth reporting.
    }
  }, DRIFT_POLL_MS)
}

/** Records forwarded from the isolated world, so one buffer holds both halves of the timeline. */
function onDiagMessage(event: Event): void {
  try {
    const detail = (event as CustomEvent).detail
    if (typeof detail !== 'string') return
    const parsed: unknown = JSON.parse(detail)
    if (!parsed || typeof parsed !== 'object') return
    const incoming = parsed as DiagRecord
    heardFromIsolated = true
    if (incoming.kind === 'write.volume') {
      const data = incoming.data ?? {}
      const stack = String(data.stack ?? '')
      lastWrite = { world: 'ext', value: Number(data.to), t: now(), stack }
      // Uses the isolated world's own `from`, which it read before writing. Reading it here instead
      // would race the write that has already landed by the time this message arrives.
      previousVolume = Number(data.from)
      observeVolume(Number(data.to), 'ext(ytimprover)', stack)
    }
    records.push({ ...incoming, world: 'ext' })
    if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS)
  } catch {
    // Malformed forward - drop it.
  }
}

interface TableRow {
  t: number
  world: string
  kind: string
  apiVolume: unknown
  elementVolumes: string
  by: unknown
  note: string
}

/** The rows most likely to explain the collapse, in one readable table. */
function table(): TableRow[] {
  return records.map((r) => {
    const d = (r.data ?? {}) as Record<string, unknown>
    const videos = (d.videos as VideoSnapshot[] | undefined) ?? []
    return {
      t: r.t,
      world: r.world,
      kind: r.kind,
      apiVolume: d.apiVolume ?? '',
      // "0.05M" = muted. Trailing "*" = that <video> is NOT inside the player, which is exactly the
      // case the feature's first-match querySelector would get wrong.
      elementVolumes: videos
        .map((v) => String(v.vol) + (v.muted ? 'M' : '') + (v.inPlayer ? '' : '*'))
        .join(' '),
      by: d.by ?? d.attributedTo ?? '',
      note: d.to !== undefined ? '-> ' + String(d.to) : '',
    }
  })
}

/** Set by the isolated half's first forwarded record, so status() can report whether it is alive. */
let heardFromIsolated = false

export function initVolumeDiag(): void {
  const armed = diagEnabled()

  // The global is published FIRST, before anything that can throw and before the gate is honoured.
  // An earlier version assigned it last, after the patching: any failure above that line produced
  // "__ytimproverDiag is not defined", which is indistinguishable from the script never having run at
  // all. The probe has to be able to report its own state, including the state "off" and "broken".
  const api = {
    armed,
    records,
    table,
    snapshot,
    dump: (): string => JSON.stringify(records, null, 1),
    clear: (): void => {
      records.length = 0
    },
    /** Only the moments where something actually moved a volume. Start here. */
    writes: (): TableRow[] =>
      table().filter((row) => row.kind.startsWith('write.') || row.kind === 'event.volumechange'),
    /** Answers "is this thing actually working?" without needing to read the timeline. */
    status: (): Record<string, unknown> => ({
      armed,
      mainWorldProbe: 'alive',
      isolatedWorldProbe: heardFromIsolated ? 'alive' : 'NOT HEARD FROM',
      records: records.length,
      playerApiVisibleHere: typeof findPlayer()?.getVolume === 'function',
      webAudioInUse,
      ytRemembered: ytRemembered(),
      ...snapshot(),
    }),
    /**
     * YouTube's own remembered volume, decoded.
     *
     * Checking this costs nothing and can settle the leading explanation outright: if YouTube has a
     * single-digit volume remembered, then it is restoring its own low number and the extension is
     * merely failing to tell it otherwise.
     */
    ytRemembered,
    collapses,
    /**
     * Everything needed to diagnose the fault, as one pasteable block.
     *
     * Deliberately not the full dump: a several-megabyte timeline is unusable in a conversation, and
     * the detected collapses plus the rows immediately around them carry the whole answer.
     */
    report: (): string => {
      const lines: string[] = []
      lines.push('=== ytimprover volume diagnostic ===')
      lines.push('armed=' + String(armed) + ' isolated=' + (heardFromIsolated ? 'alive' : 'NOT HEARD FROM'))
      lines.push('webAudioInUse=' + String(webAudioInUse))
      lines.push('playerApiVisibleInPageWorld=' + String(typeof findPlayer()?.getVolume === 'function'))
      lines.push('ytRemembered=' + JSON.stringify(ytRemembered()))
      lines.push('records=' + String(records.length) + ' collapses=' + String(collapses.length))
      lines.push('now=' + JSON.stringify(snapshot()))
      lines.push('')
      if (collapses.length === 0) {
        lines.push('NO COLLAPSE DETECTED YET.')
        lines.push('Last 40 rows so the drop can be found by hand if it was missed:')
        for (const row of table().slice(-40)) lines.push(JSON.stringify(row))
      } else {
        for (const c of collapses.slice(-5)) {
          lines.push('--- COLLAPSE ---')
          lines.push(JSON.stringify(c, null, 1))
        }
      }
      return lines.join('\n')
    },
  }
  ;(window as unknown as Record<string, unknown>).__ytimproverDiag = api

  // Unconditional, so "I see no message at all" definitively means the extension was not reloaded,
  // rather than leaving that ambiguous with "the probe is switched off".
  console.info('[ytimprover:diag] MAIN-world probe loaded. armed =', armed)
  if (!armed) return

  try {
    patchMediaVolume()
    patchWebAudio()

    // Capture phase: these media events do not bubble, but capture still visits document on the way
    // down, so one listener covers every <video> the page ever creates - including recycled ones.
    const mediaEvents = ['loadstart', 'loadedmetadata', 'emptied', 'ratechange', 'play', 'pause', 'ended']
    document.addEventListener('volumechange', onVolumeChange, true)
    for (const type of mediaEvents) document.addEventListener(type, onMediaEvent, true)

    for (const type of ['yt-navigate-start', 'yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated']) {
      document.addEventListener(type, onPageEvent)
    }
    document.addEventListener('fullscreenchange', onPageEvent)
    document.addEventListener(DIAG_CHANNEL, onDiagMessage)

    startDriftWatch()
    record('diag.armed')

    console.info(
      '[ytimprover:diag] recording. When the volume collapses, run:\n' +
        '  __ytimproverDiag.status()                  // is everything actually running?\n' +
        '  console.table(__ytimproverDiag.writes())   // who wrote the volume, and to what\n' +
        '  console.table(__ytimproverDiag.table())    // the full timeline\n' +
        '  copy(__ytimproverDiag.dump())              // whole log to the clipboard\n' +
        'elementVolumes: "0.05M" = muted, trailing "*" = that <video> is NOT inside the player.'
    )
  } catch (error) {
    // Reported loudly, not swallowed: a half-installed probe that still answers status() would
    // otherwise report itself healthy while silently missing writes.
    console.error('[ytimprover:diag] MAIN-world probe failed while arming', error)
  }
}
