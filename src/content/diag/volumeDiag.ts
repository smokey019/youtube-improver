/**
 * ISOLATED-world half of the volume diagnostic. TEMPORARY - see ./channel.ts.
 *
 * The MAIN-world twin patches the page's copy of HTMLMediaElement.prototype and therefore sees only
 * YouTube's writes. This half patches the isolated world's separate copy of that same prototype, so it
 * sees only the extension's own writes - the ones volumeControl.ts makes through
 * `video.volume = clamped / 100`. Between the two, every change to the volume is attributed to a world
 * without inferring anything from timing.
 *
 * It also records the two things that decide whether the default-volume path re-fires mid-video:
 *  - every change to location.href, including the history.replaceState calls YouTube makes without a
 *    navigation, because volumeControl keys its "already applied" bookkeeping on the full href
 *  - every yt-navigate-finish, which is what drives applyAll
 *
 * Records are forwarded to the MAIN world so a single buffer holds both halves in one timeline. They go
 * over their own channel, never the player bridge: the bridge is part of what is under suspicion, and a
 * probe that shares a code path with the feature it measures cannot say which of the two misbehaved.
 */

import { DIAG_CHANNEL, diagEnabled, type DiagRecord } from './channel'

/** Marks writes as ours even after minification renames every function in the stack. */
const EXT_TAG = 'ext(ytimprover)'

function now(): number {
  return Math.round(performance.now())
}

function forward(kind: string, data?: Record<string, unknown>): void {
  const record: DiagRecord = { t: now(), world: 'ext', kind, data }
  try {
    document.dispatchEvent(new CustomEvent(DIAG_CHANNEL, { detail: JSON.stringify(record) }))
  } catch {
    // The MAIN half may not be listening (it is flag-gated too). Console still carries the record.
  }
  // console.info, not console.debug: Chrome hides debug-level output unless "Verbose" is ticked in the
  // console's level filter, which is off by default - so the isolated half looked dead when it was not.
  console.info('[ytimprover:diag:ext]', kind, data)
}

function callerStack(): string {
  const raw = new Error().stack ?? ''
  return raw
    .split('\n')
    .slice(2, 8)
    .map((line) => line.trim().replace(/^at\s+/, ''))
    .filter(Boolean)
    .join(' <- ')
}

/**
 * Intercepts the extension's own writes to video.volume.
 *
 * Chrome gives each world its own DOM prototype objects, so this patch is invisible to YouTube and
 * YouTube's writes are invisible to it. That is precisely what makes the attribution trustworthy:
 * anything caught here was written by extension code, by construction.
 */
function patchMediaVolume(): void {
  const proto = HTMLMediaElement.prototype

  const volumeDesc = Object.getOwnPropertyDescriptor(proto, 'volume')
  if (!volumeDesc?.get || !volumeDesc.set) return
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
        const parent = this.parentElement
        forward('write.volume', {
          from,
          to: value,
          by: EXT_TAG,
          stack: callerStack(),
          // Which element the extension actually wrote to. volumeControl takes the FIRST <video> inside
          // the player, so when more than one exists this says whether it picked the audible one.
          inMoviePlayer: Boolean(this.closest('#movie_player')),
          inShortsPlayer: Boolean(this.closest('#shorts-player')),
          parentTag: parent ? parent.tagName.toLowerCase() + '.' + parent.className.slice(0, 40) : null,
        })
      } catch {
        // Instrumentation must never break the write itself.
      }
      set.call(this, value)
    },
  })
}

/**
 * Records every href change, including the ones YouTube makes without navigating.
 *
 * volumeControl builds its key as `${location.href}|${defaultVolume}`, so any silent replaceState - a
 * chapter click adding &t=, a playlist index, a player-params refresh - invalidates both appliedForKey
 * and overrodeForKey and makes the default-volume path eligible to run again on the same video.
 */
function watchHistory(): void {
  let previous = location.href

  const report = (via: string): void => {
    if (location.href === previous) return
    forward('href.change', { via, from: previous, to: location.href })
    previous = location.href
  }

  const originalPush = history.pushState.bind(history)
  const originalReplace = history.replaceState.bind(history)

  history.pushState = function patchedPush(...args: Parameters<History['pushState']>): void {
    originalPush(...args)
    report('pushState')
  }
  history.replaceState = function patchedReplace(...args: Parameters<History['replaceState']>): void {
    originalReplace(...args)
    report('replaceState')
  }

  window.addEventListener('popstate', () => report('popstate'))
  window.addEventListener('hashchange', () => report('hashchange'))
  // Catches anything the patches above miss - YouTube could hold its own reference to the originals.
  window.setInterval(() => report('poll'), 500)
}

function watchNavigation(): void {
  document.addEventListener('yt-navigate-finish', () => {
    forward('yt-navigate-finish', { href: location.href })
  })
}

/** Settings writes land in every tab, so a change made elsewhere can re-run applyAll here mid-video. */
function watchSettings(): void {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      forward('settings.changed', { area, keys: Object.keys(changes) })
    })
  } catch {
    // Storage events are a nice-to-have for this probe, not a requirement.
  }
}

export function initVolumeDiagIsolated(): void {
  const armed = diagEnabled()
  // Unconditional and at info level, so the two halves can be told apart in the console. Seeing only
  // the MAIN line means this content script did not run; seeing only this one means the MAIN-world
  // injection failed, which needs Chrome 111+ for the manifest "world" key.
  console.info('[ytimprover:diag] isolated-world probe loaded. armed =', armed)
  if (!armed) return

  try {
    patchMediaVolume()
    watchHistory()
    watchNavigation()
    watchSettings()
    forward('diag.armed.ext', { href: location.href })
  } catch (error) {
    console.debug('[ytimprover:diag] isolated-world probe failed to arm', error)
  }
}
