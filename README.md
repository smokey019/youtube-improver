# YouTube Improver

A Chrome (Manifest V3) extension that customizes YouTube's Home and Subscriptions pages, controls default video/Shorts playback quality, speed and volume (including mouse-wheel volume over the player), tames autoplay, and adds a few FrankerFaceZ/Enhancer-for-YouTube-style tweaks (hide comments/related videos, theater mode automation, a custom "Cinema mode" dimming backdrop).

The content script runs at `document_start` so the wheel listener is registered before YouTube binds its own handlers (otherwise adjusting volume on Shorts would also skip to the next video). Anything that injects CSS or reads the DOM therefore has to tolerate an empty document on its first pass — `src/content/lib/dom.ts` re-homes injected `<style>` tags into `<head>` once it exists, and one-shot actions commit their "already applied" key only after a write actually lands, so a pass against a bare DOM doesn't burn the attempt.

This is a v1 MVP scaffold — a working extension with a curated first slice of features, built to be extended with the rest of the Enhancer-for-YouTube-style feature set over time.

## Setup

Requires [Bun](https://bun.sh) (developed against 1.4.x).

```
bun install
bun run build
```

This produces a loadable extension in `dist/`.

## Load it in Chrome

1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select the `dist/` folder
4. Open any youtube.com page, then click the extension's toolbar icon (or right-click it → Options) to open the settings page

## Development

```
bun run dev        # Vite dev/watch mode
bun run typecheck  # tsc --noEmit
bun run build      # production build to dist/
```

Vite itself runs on the Bun runtime (`bun --bun vite`), not Node. After changing code, re-run `bun run build` and click the reload icon for the extension on `chrome://extensions` to pick up changes.

Note: `bun run dev` starts Vite's dev server, and `vite-plugin-web-extension` will try to auto-launch a browser with the extension loaded. If that gets in the way, pass `disableAutoLaunch: true` to the plugin in `vite.config.ts` — the build-and-load-unpacked flow above doesn't need the dev server at all.

## Architecture

- `manifest.json` — MV3 manifest (background service worker, **two** content scripts, options page)
- `src/content/bridge/` — the ISOLATED↔MAIN world player bridge (`protocol.ts` for the wire format and security model, `playerBridge.ts` for the isolated-world client)
- `src/content/main/index.ts` — the MAIN-world content script; the only code that runs inside YouTube's own JS context
- `src/types/settings.ts` — the single source of truth for all settings: the `Settings` interface, defaults, and `chrome.storage.sync` read/write/subscribe helpers
- `src/content/lib/` — shared content-script helpers (`dom.ts` for waiting-for-elements and CSS injection, `youtubeNav.ts` for detecting YouTube's SPA navigation and page type)
- `src/content/features/*.ts` — one file per feature area (Home page, Subscriptions page, Shorts quality, video quality/speed, volume, autoplay control, hide comments/related, theater/cinema mode). Each exports a single `apply*(settings)` function called on every YouTube navigation and every settings change.
- `src/content/index.ts` — wires all feature modules together
- `src/background/index.ts` — sets defaults on install, opens the options page when the toolbar icon is clicked
- `src/options/` — the settings UI (plain TypeScript + DOM APIs, no framework)

## The isolated-world player API bug (and why there are two content scripts)

For most of this project's life, **default video quality, default playback speed and default Shorts
quality never worked at all** — silently. This is the single most important thing to understand about
the architecture, because it dictates how those features are written.

YouTube attaches its imperative player API (`setPlaybackQualityRange`, `setPlaybackRate`, `setVolume`,
`getVolume`, `isMuted`, …) onto the `#movie_player` / `#shorts-player` **DOM element**, from the page's
own JavaScript. Chrome gives every isolated world its own V8 wrapper per DOM node, so those properties
do not exist for a content script running in the ISOLATED world. The element is shared between worlds;
the properties set on it are not. The code guarded those calls with `typeof player.setPlaybackRate ===
'function'`, which was always false, so it bailed out silently on every video forever.

**Why this went unnoticed for so long, and the lesson:** every time these selectors were ground-truthed
by pasting a snippet into DevTools, the API *was* visible — because the DevTools console evaluates in
the **page** world by default. The verification habit that caught every other bug in this project was
structurally incapable of catching this one. It was finally settled by a probe running inside the
extension's own content script, which reported `getPlayerState: undefined` on both a watch page and a
Short while the page-world console reported `function` for the same expression. If you are ever
checking what the extension can see, check it from the extension.

The fix is a second content script declared with `"world": "MAIN"` (a manifest key that shipped in
Chrome 111, hence `minimum_chrome_version`). It shares YouTube's JS context, so it can see the API, and
the isolated script drives it over a `CustomEvent` channel. Read the security model at the top of
`src/content/bridge/protocol.ts` before adding an operation to it — the MAIN-world script has **no
privilege boundary against the page**, so the op list is closed, every operand is re-validated on
arrival, and nothing privileged (no `chrome.*`, no storage, no settings object) ever crosses into it.

Two consequences worth knowing:

- **Commands confirm before they commit.** Each feature commits its "already applied" key only once the
  bridge reports that a player method actually ran. This is deliberate: the original bug was invisible
  precisely because failure was indistinguishable from success.
- **`setPlaybackQualityRange` writes YouTube's own `yt-player-quality` localStorage preference** with a
  ~360-day TTL. That is YouTube's behaviour, not ours, but it means a forced quality persists in
  YouTube's own settings and outlives the extension. Setting the option back to "auto" clears our
  remembered value but does not rewrite YouTube's stored preference.

Volume is deliberately **not** routed through the bridge. YouTube's `getVolume()` returns its internal
volume while `<video>.volume` is that value scaled by a loudness-normalisation gain, so mixing the two
scales makes volume drift — and YouTube persists its number to localStorage, where a corrupted value
would survive uninstalling the extension. `volumeControl.ts` therefore stays on its existing,
self-consistent `<video>.volume` path until that can be done properly.

## Known limitations (read before relying on these)

YouTube's internal DOM (custom element names, class names, button labels) changes periodically. Selectors are centralized as named constants near the top of each feature file specifically so they're easy to find and patch.

Selectors were cross-checked twice: first against real saved YouTube pages (Home, Subscriptions, a Shorts video), then against JSON dumps of those same pages' actual live, hydrated DOM (including shadow roots — a plain browser "Save As HTML" can't capture YouTube's shadow-DOM-rendered content, only a script run in the live page's own console can walk it).

**Confirmed correct as-is** (live-DOM verified):
- Home & Subscriptions: `ytd-browse[page-subtype="..."]`, the Shorts shelf marker `ytd-rich-shelf-renderer[is-shorts]`, and the grid contents container `ytd-rich-grid-renderer #contents` (the extra `.ytd-rich-grid-renderer` class qualifier we originally had was dropped — strongly implied by every child's style-scope class but not directly readable off a native `<div>`, so keeping the unverifiable half added risk for no benefit).
- Player element ids `#shorts-player` and `#movie_player` — found verbatim in YouTube's own client bootstrap config, and `#movie_player` additionally confirmed directly on a live watch page (it carries `ytp-*` state classes, e.g. `paused-mode`, `ytp-autohide`, alongside `html5-video-player`).
- Shorts container `ytd-shorts`.
- Subscriptions "Default view" (grid/list) toggle really doesn't exist — this was re-checked against the live hydrated DOM (not just the earlier static save) and confirmed absent again: zero `aria-pressed`/`aria-selected`/relevant `aria-label` anywhere on the page.
- Regular watch pages, checked against a live non-Shorts video: `.ytp-autonav-toggle-button` (a `<div>`, with `aria-checked` set directly on it, exactly matching the code's lookup priority), `.ytp-size-button` (theater toggle), `ytd-comments#comments` (there's a second, unrelated `ytd-comments` with no id nested in a side engagement panel — the `#comments` qualifier correctly disambiguates), and `ytd-watch-next-secondary-results-renderer`. The one loose end: `ytd-watch-flexy`'s `theater` boolean attribute couldn't be positively confirmed since the capture happened with theater mode off (so its *absence* there is expected, not a red flag) — it's a long-standing, widely-used convention already, so not chasing it further for now.

**Fixed real bugs found by the live-DOM check:**
- Home's shelf-title selector assumed a `<span id="title-text">`; it's actually a `<div>`, so the old selector never matched anything — fixed to a bare `#title-text`.
- Shorts comments panel's `target-id` was guessed as `"shorts-engagement-panel-comments-section"`; the real value has no `shorts-` prefix — fixed to `"engagement-panel-comments-section"`.
- Shorts quality's re-apply-on-scroll logic watched for an `is-active` attribute that doesn't exist anywhere in the live DOM (confirmed via a 12,790-node dump) — it was dead code that silently never fired. Replaced with a childList observer that re-applies quality whenever the mounted reel changes.
- Theater mode's `ytd-watch-flexy` lookup could have matched a stale, hidden instance — YouTube's SPA keeps a previous page's watch component mounted-but-hidden in the DOM for fast back-navigation (confirmed: a hidden `ytd-watch-flexy` was present even on a Shorts page). Selector now excludes `[hidden]`.
- **"Videos per row" was broken on both feeds.** YouTube lays `#contents` out as a flex row and sizes each item with `width: calc(100%/var(--ytd-rich-grid-items-per-row) - var(--ytd-rich-grid-item-margin))` — i.e. a percentage of the item's *containing block*. The original approach set `grid-template-columns` on `#contents`, which did nothing on Home (a flex container ignores it) and actively broke Subscriptions (where it also forced `display: grid`): each item's containing block shrank to one grid cell, so items computed to `272/3 - 16 = 74.7px`, and full-width shelf rows (avatar strip, chip bar, Shorts shelf — all siblings of the video items inside the same `#contents`) collapsed into single 272px cells. Now it just overrides `--ytd-rich-grid-items-per-row` with `!important` (required, because YouTube sets that variable inline per viewport) and leaves `display` alone, so YouTube's own responsive sizing does the work and shelves keep spanning the full width.
- Both feeds' selectors are now scoped to `ytd-browse[page-subtype="..."]:not([hidden])`. There are always two `ytd-rich-grid-renderer` instances present (the other feed, kept alive at `0x0` by the SPA cache) and their document order varies by page, so unscoped lookups could bind to the invisible one.

**Still best-effort / unverified:**
- Shorts quality re-application. The MutationObserver that guessed at reel swaps is gone — it was calling an API this world cannot see anyway. Quality is now re-sent per Short off `yt-navigate-finish`, *and* the MAIN-world script re-applies on the media element's `loadstart`. The belt-and-braces pairing is deliberate: a review found that a **gapless** Shorts transition can begin the next clip without firing `loadstart` at all, so neither trigger alone is sufficient. Still worth watching across a long run of Shorts.
- Autoplay blocking's timing heuristic — YouTube exposes no signal for "was this play autoplay or user-initiated," so it pauses a video that starts playing within ~1.5s of a fresh navigation. This is an approximation, not a guarantee.
- Cinema mode backdrop z-index may need tuning against YouTube's own stacking contexts once tested visually.

## Roadmap (not yet built)

From the Enhancer-for-YouTube feature audit this project started from: mini/pop-up player, volume booster overlay control, full custom theme system, custom CSS/JS injection, keyboard shortcut remapping, screenshot capture, video filters (brightness/contrast/etc.), control-bar customization, and settings import/export.

Other `.ytp-*` player-control classes confirmed present on a live watch page that could seed future features: `ytp-play-button`/`ytp-large-play-button`, `ytp-pip-button` (Picture-in-Picture), `ytp-fullscreen-button`, `ytp-subtitles-button` (captions), `ytp-remote-button` (Cast), `ytp-overflow-button` (settings menu), `ytp-playlist-menu-button`. No distinct mute-button class was observed — volume/mute appears to go through `ytp-volume-icon`/`ytp-volume-panel` instead, worth checking directly before building a mute toggle.
