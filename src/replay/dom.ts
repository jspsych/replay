import type { DomNode, ElementNode, StylesheetSnapshot } from "../schema/types.js";

/**
 * Instantiate a recorded DomNode tree into real DOM nodes.
 * Populates idMap with recorded id → live Node entries.
 * Returns the live Node created.
 */
export function instantiateDom(
  node: DomNode,
  parent: Node,
  idMap: Map<number, Node>,
  doc: Document = document
): Node {
  let liveNode: Node;

  if (node.kind === "element") {
    const el = doc.createElement(node.tag);

    for (const [name, value] of Object.entries(node.attrs)) {
      // Skip event handler attributes for security — the iframe is sandboxed
      // without allow-scripts, but defence-in-depth is still valuable.
      if (name.startsWith("on")) continue;
      try {
        el.setAttribute(name, value);
      } catch {
        // Ignore invalid attribute names (e.g. namespace prefixes)
      }
    }

    // For canvas elements: resize the drawing buffer to recorded dimensions
    // (content is blank until a canvas.snapshot event paints it). The
    // sandboxed iframe runs without allow-scripts; in that mode Chromium
    // declines to treat canvas as a replaced element with intrinsic
    // dimensions, so layout collapses to 0×0 even with CSS width/height set
    // on a default `display: inline`. Force inline-block + pin width/height
    // to restore visible size.
    if (node.tag.toLowerCase() === "canvas" && node.canvas_size) {
      const canvas = el as HTMLCanvasElement;
      canvas.width = node.canvas_size.w;
      canvas.height = node.canvas_size.h;
      canvas.style.display = "inline-block";
      canvas.style.width = `${node.canvas_size.w}px`;
      canvas.style.height = `${node.canvas_size.h}px`;
    }

    // For media elements: restore src so the element has the right shape
    // (actual playback is out of scope for v0)
    if (
      (node.tag.toLowerCase() === "video" || node.tag.toLowerCase() === "audio") &&
      node.media_src
    ) {
      // Don't autoplay; just note the src for reference
      (el as HTMLMediaElement).src = node.media_src;
    }

    idMap.set(node.id, el);
    liveNode = el;

    for (const child of node.children) {
      instantiateDom(child, el, idMap, doc);
    }
  } else if (node.kind === "text") {
    liveNode = doc.createTextNode(node.text);
    idMap.set(node.id, liveNode);
  } else {
    // comment
    liveNode = doc.createComment(node.text);
    idMap.set(node.id, liveNode);
  }

  parent.appendChild(liveNode);
  return liveNode;
}

/**
 * Mount a recorded `initial_dom` tree, choosing the right strategy based on
 * its root tag. If the root is `<body>`, attrs are applied to the iframe's
 * existing body element (so the recorded body IS the iframe body — preserving
 * the height: 100% chain that jsPsych centering depends on). Otherwise the
 * tree is appended as a child of `mountPoint` like a normal subtree.
 *
 * `mountPoint` must already be empty (and, in the body case, must be the
 * iframe body itself).
 */
export function mountInitialDom(
  initialDom: DomNode,
  mountPoint: HTMLElement,
  idMap: Map<number, Node>,
  doc: Document
): void {
  const isBodyRoot =
    initialDom.kind === "element" && initialDom.tag.toLowerCase() === "body";

  if (isBodyRoot) {
    const root = initialDom as ElementNode;
    for (const [name, value] of Object.entries(root.attrs)) {
      if (name.startsWith("on")) continue;
      try {
        mountPoint.setAttribute(name, value);
      } catch {
        // ignore invalid attribute names
      }
    }
    idMap.set(root.id, mountPoint);
    for (const child of root.children) {
      instantiateDom(child, mountPoint, idMap, doc);
    }
    return;
  }

  instantiateDom(initialDom, mountPoint, idMap, doc);
}

/**
 * Remove all descendants of a node from idMap.
 */
export function removeFromMap(node: Node, idMap: Map<number, Node>): void {
  // Walk the idMap and remove all nodes that are descendants of `node`
  // This is O(n) in the map size but maps are typically small (< few thousand)
  for (const [id, liveNode] of idMap) {
    if (node.contains(liveNode) || liveNode === node) {
      idMap.delete(id);
    }
  }
}

/**
 * Given a DomNode tree, collect all ids (including the root).
 */
export function collectIds(node: DomNode): Set<number> {
  const ids = new Set<number>();
  function walk(n: DomNode) {
    ids.add(n.id);
    if (n.kind === "element") {
      for (const child of (n as ElementNode).children) {
        walk(child);
      }
    }
  }
  walk(node);
  return ids;
}

// ---------------------------------------------------------------------------
// Stylesheets
// ---------------------------------------------------------------------------

/**
 * Install a recorded stylesheet into the iframe document head.
 * Tracks the inserted element in `sheetMap` keyed by recorded sheet id so
 * later stylesheet.update / stylesheet.remove events can find it.
 *
 * Inline sheets are inserted as <style> elements containing the captured CSS.
 * Link sheets are preferentially inlined as <style> when the captured CSS is
 * available (so cross-origin/network-restricted replays still render); we
 * fall back to <link rel="stylesheet" href> when only a URL was captured.
 */
export function installStylesheet(
  sheet: StylesheetSnapshot,
  doc: Document,
  sheetMap: Map<number, HTMLElement>
): void {
  const head = doc.head ?? doc.getElementsByTagName("head")[0];
  if (!head) return;

  let el: HTMLElement;
  if (sheet.kind === "inline") {
    const style = doc.createElement("style");
    style.textContent = sheet.css;
    if (sheet.media) style.setAttribute("media", sheet.media);
    el = style;
  } else if (sheet.css !== null) {
    // Inline the recorded CSS so we don't depend on network access at replay
    const style = doc.createElement("style");
    style.textContent = sheet.css;
    if (sheet.media) style.setAttribute("media", sheet.media);
    style.setAttribute("data-replay-href", sheet.href);
    el = style;
  } else {
    const link = doc.createElement("link");
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("href", sheet.href);
    if (sheet.media) link.setAttribute("media", sheet.media);
    el = link;
  }

  head.appendChild(el);
  sheetMap.set(sheet.id, el);
}

/**
 * Update an existing inline stylesheet's CSS text.
 * No-op if the sheet was installed as a <link> (no captured CSS) or unknown.
 */
export function updateStylesheet(
  id: number,
  css: string,
  sheetMap: Map<number, HTMLElement>
): void {
  const el = sheetMap.get(id);
  if (!el) return;
  if (el.tagName.toLowerCase() === "style") {
    el.textContent = css;
  }
}

/**
 * Remove a previously-installed stylesheet from the document.
 */
export function removeStylesheet(id: number, sheetMap: Map<number, HTMLElement>): void {
  const el = sheetMap.get(id);
  if (!el) return;
  el.parentNode?.removeChild(el);
  sheetMap.delete(id);
}
