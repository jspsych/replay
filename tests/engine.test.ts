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
    stylesheets: [],
    stylesheet_events: [],
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

  it("backfills stylesheets and stylesheet_events when missing", () => {
    const rec = makeMinimalRecording();
    const obj: Record<string, unknown> = { ...rec };
    delete obj["stylesheets"];
    delete obj["stylesheet_events"];
    const result = validate(obj);
    expect(result.stylesheets).toEqual([]);
    expect(result.stylesheet_events).toEqual([]);
  });

  it("preserves stylesheet snapshots and events on a valid recording", () => {
    const rec = makeMinimalRecording({
      stylesheets: [
        { id: 1, kind: "inline", css: ".foo { color: red; }", media: null },
        { id: 2, kind: "link", href: "/css/app.css", css: null, media: "screen" },
      ],
      stylesheet_events: [
        {
          type: "stylesheet.add",
          t: 100,
          sheet: { id: 3, kind: "inline", css: ".bar {}", media: null },
        },
        { type: "stylesheet.update", t: 200, id: 1, css: ".foo { color: blue; }" },
        { type: "stylesheet.remove", t: 300, id: 2 },
      ],
    });
    const result = validate(rec);
    expect(result.stylesheets).toHaveLength(2);
    expect(result.stylesheet_events).toHaveLength(3);
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

  it("pins canvas display + width/height in CSS so the sandboxed iframe lays it out", () => {
    // Background: with `sandbox=\"allow-same-origin\"` (no `allow-scripts`),
    // Chromium does not treat <canvas> as a sized replaced element, so HTML
    // width/height attrs alone collapse layout to 0×0. dom.ts pins via CSS.
    const node: DomNode = {
      id: 50,
      kind: "element",
      tag: "canvas",
      attrs: { id: "c", width: "400", height: "300" },
      children: [],
      canvas_size: { w: 400, h: 300 },
    };
    instantiateDom(node, container, idMap, doc);
    const canvas = idMap.get(50) as HTMLCanvasElement;
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    expect(canvas.style.display).toBe("inline-block");
    expect(canvas.style.width).toBe("400px");
    expect(canvas.style.height).toBe("300px");
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
      applyViewport: () => {},
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
      applyViewport: () => {},
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
      applyViewport: () => {},
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
      applyViewport: () => {},
      onComplete: () => {},
      onTick: () => {},
    });
    expect(() => engine.applyEventsSync([], 0)).not.toThrow();
  });

  it("applies input.value to an HTMLInputElement", async () => {
    const { ReplayEngine } = await import("../src/replay/engine");
    const doc = document.implementation.createHTMLDocument("test");
    const input = doc.createElement("input");
    input.type = "text";
    doc.body.appendChild(input);
    const idMap = new Map<number, Node>();
    idMap.set(1, input);

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
      applyViewport: () => {},
      onComplete: () => {},
      onTick: () => {},
    });

    engine.applyEventsSync(
      [{ type: "input.value", t: 0, node: 1, value: "hello world" }],
      10
    );
    expect(input.value).toBe("hello world");
  });

  it("applies input.checked to a checkbox", async () => {
    const { ReplayEngine } = await import("../src/replay/engine");
    const doc = document.implementation.createHTMLDocument("test");
    const cb = doc.createElement("input");
    cb.type = "checkbox";
    doc.body.appendChild(cb);
    const idMap = new Map<number, Node>();
    idMap.set(1, cb);

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
      applyViewport: () => {},
      onComplete: () => {},
      onTick: () => {},
    });

    engine.applyEventsSync(
      [{ type: "input.checked", t: 0, node: 1, checked: true }],
      10
    );
    expect(cb.checked).toBe(true);

    engine.applyEventsSync(
      [{ type: "input.checked", t: 0, node: 1, checked: false }],
      10
    );
    expect(cb.checked).toBe(false);
  });

  it("applies input.select to a multi-select", async () => {
    const { ReplayEngine } = await import("../src/replay/engine");
    const doc = document.implementation.createHTMLDocument("test");
    const sel = doc.createElement("select");
    sel.multiple = true;
    for (const v of ["a", "b", "c"]) {
      const opt = doc.createElement("option");
      opt.value = v;
      sel.appendChild(opt);
    }
    doc.body.appendChild(sel);
    const idMap = new Map<number, Node>();
    idMap.set(1, sel);

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
      applyViewport: () => {},
      onComplete: () => {},
      onTick: () => {},
    });

    engine.applyEventsSync(
      [{ type: "input.select", t: 0, node: 1, values: ["a", "c"] }],
      10
    );
    expect(sel.options[0].selected).toBe(true);
    expect(sel.options[1].selected).toBe(false);
    expect(sel.options[2].selected).toBe(true);
  });

  it("installs and removes a stylesheet via stylesheet events", async () => {
    const { ReplayEngine } = await import("../src/replay/engine");
    const doc = document.implementation.createHTMLDocument("test");
    const idMap = new Map<number, Node>();
    const sheetMap = new Map<number, HTMLElement>();
    const overlay = {
      moveCursor: () => {},
      showClick: () => {},
      showKey: () => {},
      setBlurred: () => {},
      hide: () => {},
      show: () => {},
    };
    const engine = new ReplayEngine(
      doc,
      idMap,
      { overlay, applyViewport: () => {}, onComplete: () => {}, onTick: () => {} },
      sheetMap
    );

    engine.applyEventsSync(
      [
        {
          type: "stylesheet.add",
          t: 0,
          sheet: { id: 1, kind: "inline", css: ".x { color: red; }", media: null },
        },
      ],
      10
    );
    expect(sheetMap.has(1)).toBe(true);
    expect(doc.head.querySelector("style")?.textContent).toBe(".x { color: red; }");

    engine.applyEventsSync(
      [{ type: "stylesheet.update", t: 0, id: 1, css: ".x { color: blue; }" }],
      10
    );
    expect(doc.head.querySelector("style")?.textContent).toBe(".x { color: blue; }");

    engine.applyEventsSync([{ type: "stylesheet.remove", t: 0, id: 1 }], 10);
    expect(sheetMap.has(1)).toBe(false);
    expect(doc.head.querySelector("style")).toBeNull();
  });

  it("rebases session-relative event times by tOffset on sync apply", async () => {
    const { ReplayEngine } = await import("../src/replay/engine");
    const doc = document.implementation.createHTMLDocument("test");
    const el = doc.createElement("div");
    doc.body.appendChild(el);
    const idMap = new Map<number, Node>();
    idMap.set(1, el);

    const showKeyCalls: string[] = [];
    const overlay = {
      moveCursor: () => {},
      showClick: () => {},
      showKey: (label: string) => showKeyCalls.push(label),
      setBlurred: () => {},
      hide: () => {},
      show: () => {},
    };

    const engine = new ReplayEngine(doc, idMap, {
      overlay,
      applyViewport: () => {},
      onComplete: () => {},
      onTick: () => {},
    });

    // Trial starts mid-session at t_dom_ready=8000ms; trial duration ~700ms.
    // Without tOffset, engine would compare session t (8478) > targetMs (700)
    // and skip the event entirely.
    const tOffset = 8000;
    engine.applyEventsSync(
      [
        {
          type: "key.down",
          t: 8478,
          key: "a",
          code: "KeyA",
          mods: { ctrl: false, shift: false, alt: false, meta: false },
          repeat: false,
          target: null,
        },
      ],
      700,
      tOffset
    );
    expect(showKeyCalls).toEqual(["a"]);
  });

  it("rebases session-relative event times by tOffset on scheduled play", async () => {
    const { ReplayEngine } = await import("../src/replay/engine");
    const doc = document.implementation.createHTMLDocument("test");
    const idMap = new Map<number, Node>();

    const showKeyCalls: string[] = [];
    const overlay = {
      moveCursor: () => {},
      showClick: () => {},
      showKey: (label: string) => showKeyCalls.push(label),
      setBlurred: () => {},
      hide: () => {},
      show: () => {},
    };

    const engine = new ReplayEngine(doc, idMap, {
      overlay,
      applyViewport: () => {},
      onComplete: () => {},
      onTick: () => {},
    });

    const tOffset = 8000;
    engine.scheduleEvents(
      [
        {
          type: "key.down",
          t: 8050, // 50ms into the trial
          key: "x",
          code: "KeyX",
          mods: { ctrl: false, shift: false, alt: false, meta: false },
          repeat: false,
          target: null,
        },
      ],
      700, // duration
      0, // fromElapsed
      1, // speed
      tOffset
    );

    await new Promise((r) => setTimeout(r, 120));
    engine.cancelAll();
    expect(showKeyCalls).toEqual(["x"]);
  });
});

// ---------------------------------------------------------------------------
// Cross-realm: nodes living in an iframe document have constructors from the
// iframe's window, not the parent's. The engine must resolve `instanceof`
// against the iframe realm or every input/attr/canvas/scroll handler silently
// drops events.
// ---------------------------------------------------------------------------

describe("ReplayEngine cross-realm (iframe)", () => {
  const overlay = {
    moveCursor: () => {},
    showClick: () => {},
    showKey: () => {},
    setBlurred: () => {},
    hide: () => {},
    show: () => {},
  };

  function makeIframeDoc(): Document {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write("<!doctype html><html><head></head><body></body></html>");
    doc.close();
    return doc;
  }

  it("applies dom.attr to an element in an iframe realm", async () => {
    const { ReplayEngine } = await import("../src/replay/engine");
    const doc = makeIframeDoc();
    const btn = doc.createElement("button");
    btn.setAttribute("disabled", "");
    doc.body.appendChild(btn);
    // Sanity: parent-realm instanceof would fail here.
    expect(btn instanceof Element).toBe(false);

    const idMap = new Map<number, Node>();
    idMap.set(1, btn);
    const engine = new ReplayEngine(doc, idMap, {
      overlay,
      applyViewport: () => {},
      onComplete: () => {},
      onTick: () => {},
    });

    engine.applyEventsSync(
      [{ type: "dom.attr", t: 0, node: 1, name: "disabled", value: null }],
      10
    );
    expect(btn.hasAttribute("disabled")).toBe(false);

    engine.applyEventsSync(
      [{ type: "dom.attr", t: 0, node: 1, name: "disabled", value: "disabled" }],
      10
    );
    expect(btn.getAttribute("disabled")).toBe("disabled");
  });

  it("applies input.value to a range slider in an iframe realm", async () => {
    const { ReplayEngine } = await import("../src/replay/engine");
    const doc = makeIframeDoc();
    const slider = doc.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = "50";
    doc.body.appendChild(slider);
    expect(slider instanceof HTMLInputElement).toBe(false);

    const idMap = new Map<number, Node>();
    idMap.set(7, slider);
    const engine = new ReplayEngine(doc, idMap, {
      overlay,
      applyViewport: () => {},
      onComplete: () => {},
      onTick: () => {},
    });

    engine.applyEventsSync(
      [{ type: "input.value", t: 0, node: 7, value: "73" }],
      10
    );
    expect(slider.value).toBe("73");
  });

  it("applies input.checked to a checkbox in an iframe realm", async () => {
    const { ReplayEngine } = await import("../src/replay/engine");
    const doc = makeIframeDoc();
    const cb = doc.createElement("input");
    cb.type = "checkbox";
    doc.body.appendChild(cb);

    const idMap = new Map<number, Node>();
    idMap.set(1, cb);
    const engine = new ReplayEngine(doc, idMap, {
      overlay,
      applyViewport: () => {},
      onComplete: () => {},
      onTick: () => {},
    });

    engine.applyEventsSync(
      [{ type: "input.checked", t: 0, node: 1, checked: true }],
      10
    );
    expect(cb.checked).toBe(true);
  });
});
