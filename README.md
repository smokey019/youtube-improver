# YouTube Improver

A Chrome (Manifest V3) extension that customizes YouTube's Home and Subscriptions pages, controls default video/Shorts playback quality and speed, tames autoplay, and adds a few FrankerFaceZ/Enhancer-for-YouTube-style tweaks (hide comments/related videos, theater mode automation, a custom "Cinema mode" dimming backdrop).

This is a v1 MVP scaffold — a working extension with a curated first slice of features, built to be extended with the rest of the Enhancer-for-YouTube-style feature set over time.

## Setup

```
npm install
npm run build
```

This produces a loadable extension in `dist/`.

## Load it in Chrome

1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select the `dist/` folder
4. Open any youtube.com page, then click the extension's toolbar icon (or right-click it → Options) to open the settings page

## Development

```
npm run dev        # Vite dev/watch mode
npm run typecheck  # tsc --noEmit
npm run build      # production build to dist/
```

After changing code, re-run `npm run build` (or use `npm run dev`) and click the reload icon for the extension on `chrome://extensions` to pick up changes.

## Architecture

- `manifest.json` — MV3 manifest (background service worker, content script, options page)
- `src/types/settings.ts` — the single source of truth for all settings: the `Settings` interface, defaults, and `chrome.storage.sync` read/write/subscribe helpers
- `src/content/lib/` — shared content-script helpers (`dom.ts` for waiting-for-elements and CSS injection, `youtubeNav.ts` for detecting YouTube's SPA navigation and page type)
- `src/content/features/*.ts` — one file per feature area (Home page, Subscriptions page, Shorts quality, video quality/speed, autoplay control, hide comments/related, theater/cinema mode). Each exports a single `apply*(settings)` function called on every YouTube navigation and every settings change.
- `src/content/index.ts` — wires all feature modules together
- `src/background/index.ts` — sets defaults on install, opens the options page when the toolbar icon is clicked
- `src/options/` — the settings UI (plain TypeScript + DOM APIs, no framework)

## Known limitations (read before relying on these)

YouTube's internal DOM (custom element names, class names, button labels) changes periodically. Selectors are centralized as named constants near the top of each feature file specifically so they're easy to find and patch.

Selectors were cross-checked against real saved YouTube pages (Home, Subscriptions, a Shorts video). That surfaced one important caveat: a plain browser "Save As HTML" does **not** capture YouTube's shadow-DOM-rendered content — only the top-level shell and the raw `ytInitialData`/player-config JSON survive. That JSON confirmed a few things directly and ruled out one planned feature entirely, but most rendered-DOM selectors below remain best-effort until checked against the live DOM (DevTools Elements panel, which does pierce shadow DOM):

- **Confirmed correct**: the player element ids `#shorts-player` and `#movie_player` — found verbatim in YouTube's own client bootstrap config.
- **Removed**: Subscriptions "Default view" (grid/list) was dropped entirely — there is no trace of a view-mode toggle anywhere in the page data (no `aria-label`/`role="button"`/`aria-pressed` in the DOM-adjacent shell, and no view-mode field anywhere in `ytInitialData`), consistent with the Subscriptions feed being a single fixed-layout grid on current YouTube. Not worth keeping a settings toggle for a control that doesn't exist.
- **Shorts quality** — `#shorts-player` id is confirmed; the active-item detection (`ytd-reel-video-renderer[is-active]`) and container (`ytd-shorts`) are still unverified.
- **Shorts comments** — confirmed Shorts uses a slide-out engagement panel instead of `ytd-comments#comments`; "Hide comments" now also targets `ytd-engagement-panel-section-list-renderer[target-id="shorts-engagement-panel-comments-section"]`, though that `target-id` value is inferred from a JSON identifier, not observed rendered markup.
- **Home/Subscriptions Shorts shelf** — still primarily targets an `is-shorts` attribute (a long-standing, widely-used YouTube convention, but unconfirmed here). On the Home page, "Hide Shorts shelf" now also feeds "shorts" into the same title-text matcher used by "Hide shelves containing" as a fallback, since the data confirms the shelf's title is literally "Shorts".
- **Autoplay blocking** — YouTube exposes no signal for "was this play autoplay or user-initiated," so blocking uses a short timing heuristic (pause a video that starts playing within ~1.5s of a fresh navigation). This is an approximation, not a guarantee.
- **Cinema mode** backdrop z-index may need tuning against YouTube's own stacking contexts once tested visually.

If you want full certainty on the remaining best-effort selectors, the most useful artifact isn't another "Save As HTML" (same shadow-DOM gap) — it's either live DevTools inspection, or a snippet run in the live page's console that walks open shadow roots and dumps the relevant markup to a file.

## Roadmap (not yet built)

From the Enhancer-for-YouTube feature audit this project started from: mini/pop-up player, volume booster overlay control, full custom theme system, custom CSS/JS injection, keyboard shortcut remapping, screenshot capture, video filters (brightness/contrast/etc.), control-bar customization, and settings import/export.
