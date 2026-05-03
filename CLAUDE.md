# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `pnpm dev` — start Vite dev server at `http://localhost:5173`. The page starts empty; load a recording via the header button or drag-and-drop.
- `pnpm build` — type-check (`tsc`) and produce a static SPA in `dist/`. Vite uses `base: "/replay/"` in production (GitHub Pages), `"./"` in dev.
- `pnpm test` — run the vitest suite once (jsdom environment).
- `pnpm test:watch` — vitest in watch mode.
- Run a single test file: `pnpm test tests/engine.test.ts`. Filter by name: `pnpm test -t "applies dom.text"`.

`main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## Architecture

The app is an observational replayer for jsPsych session recordings. It does **not** re-run plugin code — it reconstructs DOM and dispatches recorded inputs onto an isolated stage.

### Schema contract
Only `schema_version: 1` is accepted (see `src/schema/types.ts`). Any other version throws in `validate()`. The schema mirrors `jspsych/jspsych` `packages/jspsych/src/modules/recording.ts` and is the source of truth for everything else in the codebase. When updating types, also update `validate()` and the test fixtures in `tests/engine.test.ts`. Stylesheet fields (`stylesheets`, `stylesheet_events`) are backfilled to `[]` for older recordings.

### The replay stage
Recorded DOM is mounted inside an `<iframe sandbox="allow-same-origin">` (no `allow-scripts`) declared in `index.html`. Defence-in-depth: `instantiateDom()` and the `dom.attr` handler both strip `on*` attributes regardless of sandbox. When touching either of these paths, the security tests in `tests/engine.test.ts` enforce this — keep them passing.

### Time model
All event times `t` are in ms relative to `recording_started_at_perf`. Per-trial playback duration is `t_end - t_dom_ready` (see `Player.trialDuration`). The engine merges per-trial `RecordedEvent`s with session-level `StylesheetEvent`s into one timeline (`SchedulableEvent`) — both share the `type` + `t` shape.

### Id mapping
Every recorded DOM node has a stable numeric `id`. `instantiateDom()` builds an `idMap: Map<number, Node>` linking recorded ids to live nodes; the engine resolves every `dom.*`, `input.*`, `scroll.element`, `media.*`, and `canvas.snapshot` event through it. A separate `sheetMap: Map<number, HTMLElement>` tracks installed stylesheets. **Both maps must be torn down and rebuilt on trial change or seek** — `Player.selectTrial` and `Player.seekTo` do this, and `removeFromMap()` cleans descendants on `dom.remove`.

### Seek vs. play
- **Play**: `ReplayEngine.scheduleEvents()` posts a `setTimeout` per event scaled by `speed`, plus a RAF ticker for smooth scrub-bar updates.
- **Seek/scrub**: re-instantiate `initial_dom`, replay session stylesheets up to `t_dom_ready`, then `applyEventsSync()` walks every event with `t <= target` synchronously. The engine is left paused at `target`. Speed changes mid-play also take this round-trip via `cancelAll` + `scheduleEvents`.

The stylesheet snapshot is anchored at `t_dom_ready` (not `t_start`) because plugins commonly inject their CSS in the `t_start..t_dom_ready` window — anchoring earlier would miss layout-defining sheets. Mid-trial stylesheet events (between `t_dom_ready` and `t_end`) are merged into the playback timeline by `Player.trialTimeline` so they're scheduled during play and replayed during seek alongside per-trial events.

### Module boundaries
- `src/schema/` — pure types + `validate()`. No DOM dependency.
- `src/replay/` — DOM reconstruction (`dom.ts`), event scheduling/dispatch (`engine.ts`), iframe sizing (`viewport.ts`).
- `src/ui/` — `Player` (orchestrates engine + viewport + UI controls), `Sidebar` (trial list + `trial_data` JSON viewer), `overlay.ts` (cursor dot, keystroke indicator, focus/blur overlay).
- `src/main.ts` — wires DOM elements from `index.html` to the modules; loads the sample recording on startup if reachable.

UI elements live in `index.html` and are looked up by id in `main.ts` — when adding controls, add the element there and pass the reference through `Player`'s constructor `elements` bag.

### What's not implemented (v0)
Media playback, clipboard surface, and fullscreen visualization are logged-only. Don't add tests asserting full media replay until the engine handler is real.
