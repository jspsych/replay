import type { DomNode, ElementNode } from "../schema/types.js";

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

    // For canvas elements: resize to recorded dimensions (content is blank)
    if (node.tag.toLowerCase() === "canvas" && node.canvas_size) {
      (el as HTMLCanvasElement).width = node.canvas_size.w;
      (el as HTMLCanvasElement).height = node.canvas_size.h;
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
