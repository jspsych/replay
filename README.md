# replay

A single-page web app that loads a JSON recording produced by `jsPsych.getSessionRecording()` (`record_session: true`) and reconstructs a visual replay of the participant's session.

## Overview

The replayer is purely observational — it applies recorded DOM mutations and visualizes recorded input events. It does not re-run plugin code.

**Schema contract:** recordings with `schema_version: 1` are supported. Any other version is rejected.

## Features

- **Load recordings** via file picker or drag-and-drop
- **Trial sidebar** — list of all trials with plugin name; click to jump
- **Trial data viewer** — see the recorded `trial_data` JSON for the selected trial
- **DOM replay** — reconstructs `initial_dom` at each trial's `on_load` state
- **Event playback** — applies mutations, mouse/touch/keyboard input events in real time
- **Player controls** — play, pause, restart, prev/next trial
- **Scrub bar** — seek anywhere within a trial (applies events synchronously up to the target)
- **Speed control** — 0.25×, 0.5×, 1×, 2×, 4×
- **Cursor overlay** — tracks `mouse.move` / `touch` positions
- **Keystroke indicator** — last 3 keys shown on-screen
- **Focus/blur overlay** — shows when the window was blurred during the session
- **Viewport resizing** — iframe resizes to match `viewport` / `viewport_changes`

## Getting Started

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173` and use **Load Recording…** (or drag-and-drop a `.json` file onto the page) to load a recording.

## Build

```bash
pnpm build
```

Output is in `dist/` — a static SPA that can be served from any web server or opened locally.

## Tests

```bash
pnpm test
```

Unit tests (vitest) cover:
- `validate()` — schema version checking, field validation, JSON string input
- `instantiateDom()` — element/text/comment node creation, id map registration, security (no `on*` attrs), recursive children
- `ReplayEngine.applyEventsSync()` — `dom.text`, `dom.attr`, security, empty events

## Architecture

```
src/
├── main.ts               # bootstrap: file picker, wires sidebar + player
├── schema/
│   └── types.ts          # schema types + validate()
├── replay/
│   ├── dom.ts            # instantiateDom(), removeFromMap()
│   ├── engine.ts         # ReplayEngine: scheduling + event dispatch
│   └── viewport.ts       # ViewportManager: iframe sizing
└── ui/
    ├── player.ts         # Player: play/pause/seek/speed/trial nav
    ├── sidebar.ts        # Sidebar: trial list + trial_data viewer
    └── overlay.ts        # cursor dot + keystroke indicator + focus overlay
```

The replay stage is an `<iframe sandbox="allow-same-origin">` so the recorded DOM cannot fire scripts.

## Capturing your own recording

1. Add `record_session: true` to your `initJsPsych` call.
2. On finish, run in the console: `copy(JSON.stringify(jsPsych.getSessionRecording()))`.
3. Save the output as a `.json` file and open it in this app.

## Schema version contract

This replayer only supports `schema_version: 1`. Recordings with any other version will display a validation error. See [jspsych/jsPsych#3661](https://github.com/jspsych/jsPsych/pull/3661) for the full schema specification.
