# YouTube Improver

Chrome MV3 extension (TypeScript, Vite, Bun). See README.md for features and the long-form history.

## Commands
- `bun run build` — REQUIRED after any source change. Chrome loads `dist/`, not `src/`; `bun run typecheck` alone changes nothing the user sees. Then reload the extension on `chrome://extensions` and refresh the YouTube tab.
- `bun run typecheck` — `tsc --noEmit`
- No Python on this machine; use Edit or bun/node for scripted file edits.

## Architecture
- `src/content/features/*.ts` — one `apply*(settings)` per feature, called on every navigation and settings change
- `src/content/main/index.ts` — MAIN-world script, the only code that can see YouTube's player API
- `src/content/bridge/` — ISOLATED↔MAIN command channel; read the security model at the top of `protocol.ts` before adding an op (closed op list, no generic calls, nothing privileged crosses)
- `src/types/settings.ts` — single source of truth for settings and defaults

## Gotchas
- Player methods (`setVolume`, `setPlaybackRate`, …) are invisible to the ISOLATED content script. Never feature-detect them there; send a bridge command. Verify from inside the extension, not the DevTools console (page world).
- YouTube's CSS classes are camelCase (`ytContentMetadataViewModelMetadataRow`), not the old kebab-case. Selectors that worked against older DOM dumps may match nothing.
- Feed selectors must be scoped to `ytd-browse[page-subtype="..."]:not([hidden])`; the SPA keeps a hidden second copy mounted.
- Home/Subscriptions features (videos per row, hide Shorts, filters) do nothing unless `homePage.enabled` / `subscriptionsPage.enabled` is true, and both default to false. With the toggle off the feature injects no `<style>` at all. Check the options page before debugging selectors; the CSS itself still works on current YouTube.
- `player.setVolume(v)` alone is not persisted, and the Shorts player restores its stored volume ~100ms after a Short activates, undoing the write. Always pass `true` as the second argument (see `main/index.ts`).
- `setPlaybackQualityRange` reloads the media (`emptied` → `loadstart`), so anything that re-asserts quality on `loadstart` also fires on the user's own menu pick. `userPickedQuality` in `main/index.ts` exists for that.
- Diagnostic probes must be inert unless invoked and must not share the bridge channel or state with the feature they measure. A probe that did both once caused the bug it was meant to find.
