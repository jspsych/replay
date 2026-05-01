import { describe, it, expect, beforeEach } from "vitest";
import { validate } from "../src/schema/types";
import type { SessionRecording, DomNode } from "../src/schema/types";
import { instantiateDom } from "../src/replay/dom";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalRecording(overrides: Partial<SessionRecording> = {}): SessionRecording {
  return {
    schema_version: 1,
    jspsych_version: "8.0.0",
    recording_started_at: "2024-01-01T00:00:00.000Z",
    recording_started_at_perf: 0,
    user_agent: "test",
    viewport: { w: 800, h: 600, dpr: 1, scale: 1, offset_x: 0, offset_y: 0 },
    rng: { seed: "abc", math_random_patched: true },
    display_element_id: "jspsych-content",
    trials: [],
    viewport_changes: [],
    rng_calls: [],
    ended_at_perf: 1000,
    end_reason: "finished",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validate()
// ---------------------------------------------------------------------------

describe("validate()", () => {
  it("accepts a valid schema_version 1 recording object", () => {
    const rec = makeMinimalRecording();
    expect(() => validate(rec)).not.toThrow();
    const result = validate(rec);
    expect(result.schema_version).toBe(1);
  });

  it("accepts a valid recording as a JSON string", () => {
    const rec = makeMinimalRecording();
    const json = JSON.stringify(rec);
    const result = validate(json);
    expect(result.schema_version).toBe(1);
  });

  it("throws on invalid JSON string", () => {
    expect(() => validate("not valid json {")).toThrow(/Invalid JSON/);
  });

  it("throws on schema_version 2", () => {
    expect(() =>
      validate({ ...makeMinimalRecording(), schema_version: 2 as unknown as 1 })
    ).toThrow(/Unsupported schema_version/);
  });

  it("throws when schema_version is missing", () => {
    const obj: Record<string, unknown> = { ...makeMinimalRecording() };
    delete obj["schema_version"];
    expect(() => validate(obj)).toThrow(/schema_version/);
  });

  it("throws when trials field is not an array", () => {
    expect(() =>
      validate({ ...makeMinimalRecording(), trials: null as unknown as [] })
    ).toThrow(/trials/);
  });

  it("throws on a non-object input", () => {
    expect(() => validate(42)).toThrow(/Recording must be a JSON object/);
  });

  it("throws on null input", () => {
    expect(() => validate(null)).toThrow(/Recording must be a JSON object/);
  });

  it("throws on array input", () => {
    expect(() => validate([])).toThrow(/Recording must be a JSON object/);
  });

  it("preserves all fields on a valid recording", () => {
    const rec = makeMinimalRecording({
      trials: [
        {
          trial_index: 0,
          t_start: 100,
          t_dom_ready: 150,
          t_end: 500,
          plugin: "html-keyboard-response",
          initial_dom: null,
          events: [],
          trial_data: { rt: 350, response: "a" },
        },
      ],
    });
    const result = validate(rec);
    expect(result.trials).toHaveLength(1);
    expect(result.trials[0].plugin).toBe("html-keyboard-response");
  });
});

// ---------------------------------------------------------------------------
// instantiateDom()
// ---------------------------------------------------------------------------

describe("instantiateDom()", () => {
  let doc: Document;
  let container: HTMLElement;
  let idMap: Map<number, Node>;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument("test");
    container = doc.createElement("div");
    doc.body.appendChild(container);
    idMap = new Map();
  });

  it("creates an element node and registers its id", () => {
    const node: DomNode = {
      id: 1,
      kind: "element",
      tag: "p",
      attrs: { class: "prompt" },
      children: [],
    };
    instantiateDom(node, container, idMap, doc);
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.tagName.toLowerCase()).toBe("p");
    expect(container.firstElementChild?.getAttribute("class")).toBe("prompt");
    expect(idMap.get(1)).toBe(container.firstElementChild);
  });

  it("creates a text node and registers its id", () => {
    const node: DomNode = { id: 2, kind: "text", text: "Hello world" };
    instantiateDom(node, container, idMap, doc);
    expect(container.childNodes).toHaveLength(1);
    expect(container.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(container.firstChild?.nodeValue).toBe("Hello world");
    expect(idMap.get(2)).toBe(container.firstChild);
  });

  it("creates a comment node and registers its id", () => {
    const node: DomNode = { id: 3, kind: "comment", text: "a comment" };
    instantiateDom(node, container, idMap, doc);
    expect(container.childNodes).toHaveLength(1);
    expect(container.firstChild?.nodeType).toBe(Node.COMMENT_NODE);
    expect(idMap.get(3)).toBe(container.firstChild);
  });

  it("recursively creates children and registers all ids", () => {
    const node: DomNode = {
      id: 10,
      kind: "element",
      tag: "div",
      attrs: {},
      children: [
        { id: 11, kind: "element", tag: "span", attrs: {}, children: [] },
        { id: 12, kind: "text", text: "text" },
      ],
    };
    instantiateDom(node, container, idMap, doc);
    expect(idMap.size).toBe(3);
    expect(idMap.get(10)).toBeTruthy();
    expect(idMap.get(11)).toBeTruthy();
    expect(idMap.get(12)).toBeTruthy();

    const divEl = idMap.get(10) as HTMLElement;
    expect(divEl.children).toHaveLength(1);
    expect(divEl.childNodes).toHaveLength(2);
  });

  it("skips on* attributes for security", () => {
    const node: DomNode = {
      id: 20,
      kind: "element",
      tag: "button",
      attrs: { onclick: "alert(1)", class: "btn" },
      children: [],
    };
    instantiateDom(node, container, idMap, doc);
    const btn = idMap.get(20) as HTMLButtonElement;
    expect(btn.getAttribute("onclick")).toBeNull();
    expect(btn.getAttribute("class")).toBe("btn");
  });

  it("produces matching outerHTML for a simple fixture", () => {
    const node: DomNode = {
      id: 30,
      kind: "element",
      tag: "div",
      attrs: { id: "jspsych-content" },
      children: [
        {
          id: 31,
          kind: "element",
          tag: "p",
          attrs: {},
          children: [{ id: 32, kind: "text", text: "Press any key to continue." }],
        },
      ],
    };
    instantiateDom(node, container, idMap, doc);
    const div = idMap.get(30) as HTMLElement;
    expect(div.outerHTML).toBe(
      '<div id="jspsych-content"><p>Press any key to continue.</p></div>'
    );
  });

  it("handles empty children array", () => {
    const node: DomNode = {
      id: 40,
      kind: "element",
      tag: "div",
      attrs: {},
      children: [],
    };
    instantiateDom(node, container, idMap, doc);
    expect((idMap.get(40) as HTMLElement).innerHTML).toBe("");
  });
});

// ---------------------------------------------------------------------------
// ReplayEngine event dispatch
// ---------------------------------------------------------------------------

describe("ReplayEngine event dispatch", () => {
  it("applies dom.text event to a text node", async () => {
    const { ReplayEngine } = await import("../src/replay/engine");

    const doc = document.implementation.createHTMLDocument("test");
    const container = doc.createElement("div");
    doc.body.appendChild(container);
    const idMap = new Map<number, Node>();
    const textNode = doc.createTextNode("original");
    container.appendChild(textNode);
    idMap.set(1, textNode);

    const overlay = {
      moveCursor: () => {},
      showClick: () => {},
      showKey: () => {},
      setBlurred: () => {},
      hide: () => {},
      show: () => {},
    };

    const completeCalls: number[] = [];
    const engine = new ReplayEngine(doc, idMap, {
      overlay,
      onComplete: () => completeCalls.push(1),
      onTick: () => {},
    });

    engine.applyEventsSync([{ type: "dom.text", t: 0, node: 1, text: "updated" }], 10);
    expect(textNode.nodeValue).toBe("updated");
  });

  it("applies dom.attr event to set an attribute", async () => {
    const { ReplayEngine } = await import("../src/replay/engine");

    const doc = document.implementation.createHTMLDocument("test");
    const el = doc.createElement("div");
    doc.body.appendChild(el);
    const idMap = new Map<number, Node>();
    idMap.set(1, el);

    const overlay = {
      moveCursor: () => {},
      showClick: () => {},
      showKey: () => {},
      setBlurred: () => {},
      hide: () => {},
      show: () => {},
    };

    const engine = new ReplayEngine(doc, idMap, {
      overlay,
      onComplete: () => {},
      onTick: () => {},
    });

    engine.applyEventsSync(
      [{ type: "dom.attr", t: 0, node: 1, name: "data-test", value: "hello" }],
      10
    );
    expect(el.getAttribute("data-test")).toBe("hello");

    engine.applyEventsSync(
      [{ type: "dom.attr", t: 0, node: 1, name: "data-test", value: null }],
      10
    );
    expect(el.getAttribute("data-test")).toBeNull();
  });

  it("does not apply on* attrs via dom.attr for security", async () => {
    const { ReplayEngine } = await import("../src/replay/engine");

    const doc = document.implementation.createHTMLDocument("test");
    const el = doc.createElement("div");
    doc.body.appendChild(el);
    const idMap = new Map<number, Node>();
    idMap.set(1, el);

    const overlay = {
      moveCursor: () => {},
      showClick: () => {},
      showKey: () => {},
      setBlurred: () => {},
      hide: () => {},
      show: () => {},
    };

    const engine = new ReplayEngine(doc, idMap, {
      overlay,
      onComplete: () => {},
      onTick: () => {},
    });

    engine.applyEventsSync(
      [{ type: "dom.attr", t: 0, node: 1, name: "onclick", value: "alert(1)" }],
      10
    );
    expect(el.getAttribute("onclick")).toBeNull();
  });

  it("handles empty events array gracefully", async () => {
    const { ReplayEngine } = await import("../src/replay/engine");
    const doc = document.implementation.createHTMLDocument("test");
    const idMap = new Map<number, Node>();
    const overlay = {
      moveCursor: () => {},
      showClick: () => {},
      showKey: () => {},
      setBlurred: () => {},
      hide: () => {},
      show: () => {},
    };
    const engine = new ReplayEngine(doc, idMap, {
      overlay,
      onComplete: () => {},
      onTick: () => {},
    });
    expect(() => engine.applyEventsSync([], 0)).not.toThrow();
  });
});
