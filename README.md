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

YouTube's internal DOM (custom element names, class names, button labels) changes periodically and isn't something that can be verified without testing against the live site. Selectors are centralized as named constants near the top of each feature file specifically so they're easy to find and patch. Known weak spots, worth checking first if something doesn't work:

- **Subscriptions "Default view" (grid/list)** — relies on YouTube's native toggle buttons exposing a recognizable `aria-label`/`title` and a pressed/selected state; if YouTube's current markup doesn't expose that, this feature silently no-ops rather than risk clicking the wrong control.
- **Shorts quality** — depends on `#shorts-player` and an `is-active` attribute on the active feed item; both are best-effort.
- **Autoplay blocking** — YouTube exposes no signal for "was this play autoplay or user-initiated," so blocking uses a short timing heuristic (pause a video that starts playing within ~1.5s of a fresh navigation). This is an approximation, not a guarantee.
- **Cinema mode** backdrop z-index may need tuning against YouTube's own stacking contexts once tested visually.

## Roadmap (not yet built)

From the Enhancer-for-YouTube feature audit this project started from: mini/pop-up player, volume booster overlay control, full custom theme system, custom CSS/JS injection, keyboard shortcut remapping, screenshot capture, video filters (brightness/contrast/etc.), control-bar customization, and settings import/export.
