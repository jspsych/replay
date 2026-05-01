// ---------------------------------------------------------------------------
// Schema types for jsPsych session recordings (schema_version: 1)
// Copied from jspsych/jspsych packages/jspsych/src/modules/recording.ts
// ---------------------------------------------------------------------------

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface SessionRecording {
  schema_version: 1;
  jspsych_version: string;
  recording_started_at: string;
  recording_started_at_perf: number;
  user_agent: string;
  viewport: ViewportState;
  rng: { seed: string | null; math_random_patched: boolean };
  display_element_id: string;
  stylesheets: StylesheetSnapshot[];
  stylesheet_events: StylesheetEvent[];
  trials: TrialRecording[];
  viewport_changes: ViewportChange[];
  rng_calls: RngCall[];
  ended_at_perf: number | null;
  end_reason: "finished" | "aborted" | "unload" | null;
}

export type StylesheetSnapshot =
  | { id: number; kind: "inline"; css: string; media: string | null }
  | { id: number; kind: "link"; href: string; css: string | null; media: string | null };

export type StylesheetEvent =
  | { type: "stylesheet.add"; t: number; sheet: StylesheetSnapshot }
  | { type: "stylesheet.remove"; t: number; id: number }
  | { type: "stylesheet.update"; t: number; id: number; css: string };

export interface ViewportState {
  w: number;
  h: number;
  dpr: number;
  scale: number;
  offset_x: number;
  offset_y: number;
}

export interface ViewportChange extends ViewportState {
  t: number;
}

export interface TrialRecording {
  trial_index: number;
  t_start: number;
  t_dom_ready: number | null;
  t_end: number | null;
  plugin: string;
  initial_dom: DomNode | null;
  events: RecordedEvent[];
  trial_data: JsonValue;
}

export type DomNode = ElementNode | TextNode | CommentNode;

export interface ElementNode {
  id: number;
  kind: "element";
  tag: string;
  attrs: Record<string, string>;
  children: DomNode[];
  canvas_size?: { w: number; h: number };
  media_src?: string;
}

export interface TextNode {
  id: number;
  kind: "text";
  text: string;
}

export interface CommentNode {
  id: number;
  kind: "comment";
  text: string;
}

export type RecordedEvent =
  | DomMutation
  | InputRecord
  | ClipboardRecord
  | MediaRecord
  | FocusRecord
  | ScrollRecord
  | CanvasSnapshot;

export type DomMutation =
  | { type: "dom.add"; t: number; parent: number; before: number | null; node: DomNode }
  | { type: "dom.remove"; t: number; node: number }
  | { type: "dom.attr"; t: number; node: number; name: string; value: string | null }
  | { type: "dom.text"; t: number; node: number; text: string };

export type InputRecord =
  | { type: "mouse.move"; t: number; x: number; y: number }
  | {
      type: "mouse.down" | "mouse.up" | "mouse.click";
      t: number;
      x: number;
      y: number;
      button: number;
      target: number | null;
    }
  | {
      type: "touch.start" | "touch.move" | "touch.end";
      t: number;
      touches: { id: number; x: number; y: number }[];
    }
  | {
      type: "key.down" | "key.up";
      t: number;
      key: string;
      code: string;
      mods: { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };
      repeat: boolean;
      target: number | null;
    }
  | { type: "input.value"; t: number; node: number; value: string }
  | { type: "input.checked"; t: number; node: number; checked: boolean }
  | { type: "input.select"; t: number; node: number; values: string[] };

export interface ClipboardRecord {
  type: "clipboard.copy" | "clipboard.cut" | "clipboard.paste";
  t: number;
  text: string | null;
  html: string | null;
  target: number | null;
}

export type MediaRecord = {
  type: "media.play" | "media.pause" | "media.ended" | "media.seeked" | "media.time";
  t: number;
  node: number;
  current_time: number;
};

export interface FocusRecord {
  type: "focus" | "blur" | "fullscreen.enter" | "fullscreen.exit";
  t: number;
}

export type ScrollRecord =
  | { type: "scroll.window"; t: number; x: number; y: number }
  | { type: "scroll.element"; t: number; node: number; x: number; y: number };

export interface CanvasSnapshot {
  type: "canvas.snapshot";
  t: number;
  node: number;
  data_url: string;
}

export interface RngCall {
  t: number;
  fn: string;
  args: JsonValue;
  result: JsonValue;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Parse and validate a JSON string or object as a SessionRecording.
 * Throws a descriptive Error if validation fails.
 */
export function validate(input: unknown): SessionRecording {
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch (e) {
      throw new Error(`Invalid JSON: ${(e as Error).message}`);
    }
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Recording must be a JSON object");
  }

  const obj = input as Record<string, unknown>;

  if (!("schema_version" in obj)) {
    throw new Error("Missing required field: schema_version");
  }

  if (obj["schema_version"] !== 1) {
    throw new Error(
      `Unsupported schema_version: ${String(obj["schema_version"])}. This replayer only supports version 1.`
    );
  }

  if (!Array.isArray(obj["trials"])) {
    throw new Error("Missing or invalid field: trials (expected array)");
  }

  if (typeof obj["jspsych_version"] !== "string") {
    throw new Error("Missing or invalid field: jspsych_version (expected string)");
  }

  // Backward-compat: stylesheet fields were added later. Default to empty
  // arrays so older recordings still load.
  if (!Array.isArray(obj["stylesheets"])) {
    obj["stylesheets"] = [];
  }
  if (!Array.isArray(obj["stylesheet_events"])) {
    obj["stylesheet_events"] = [];
  }

  return input as SessionRecording;
}
