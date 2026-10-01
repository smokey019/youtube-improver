/**
 * Shared vocabulary for the volume diagnostic.
 *
 * TEMPORARY. This exists to find one bug: the volume intermittently collapsing to ~5%. Delete the whole
 * src/content/diag directory, its MAIN-world twin, and the two init calls once that is answered.
 *
 * Two rules it inherits from the rest of the extension, and one of its own:
 *  - Imported by the MAIN-world bundle, so it must never touch chrome.* or anything that does
 *    (see ../bridge/protocol.ts, invariant 2). Constants and types only.
 *  - It deliberately does NOT reuse the player bridge. That bridge is the thing under suspicion, and a
 *    probe sharing a code path with the feature it measures cannot tell you which one misbehaved.
 *  - It is inert unless explicitly switched on, so a build that accidentally ships it does nothing.
 */

/** Distinct from BRIDGE_CHANNEL on purpose: diagnostic traffic must not ride the channel under test. */
export const DIAG_CHANNEL = 'ytimprover-diag-v1'

/**
 * localStorage['ytimprover-diag'] = '0' disables the probe; anything else leaves it on.
 *
 * Deliberately opt-OUT rather than opt-in. Opt-in cost a debugging round trip: arming it needed an
 * extension reload, a localStorage write and a page reload in the right order, and getting any one of
 * them wrong produced the same symptom as a broken probe - nothing at all. The probe is only worth
 * having if it is reporting by the time anyone thinks to look at it.
 *
 * This is safe only because the whole diag is temporary and local. Delete src/content/diag, its
 * MAIN-world twin and the two init calls before shipping, rather than relying on this flag.
 */
export const DIAG_FLAG = 'ytimprover-diag'

export type DiagWorld = 'page' | 'ext'

export interface DiagRecord {
  /** ms since this world's navigation start. The two worlds share a timeline, so records interleave. */
  t: number
  world: DiagWorld
  kind: string
  /** Free-form payload. Kept JSON-serializable: it crosses worlds as a string. */
  data?: Record<string, unknown>
}

export function diagEnabled(): boolean {
  try {
    return localStorage.getItem(DIAG_FLAG) !== '0'
  } catch {
    // Storage can be blocked entirely (hardened profiles, third-party cookie settings). That must not
    // decide whether the probe runs - a probe that silently disables itself is worse than no probe.
    return true
  }
}
