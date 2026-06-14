/**
 * Canvas export (HEL-691) — render the whole workflow graph to a PNG.
 *
 * React Flow doesn't ship a rasterizer; the official pattern is html-to-image's
 * `toPng` over the `.react-flow__viewport` element, with the viewport transformed
 * (via `getNodesBounds` + `getViewportForBounds`) so the FULL graph fits the
 * image regardless of the current pan/zoom.
 */
import { toPng } from "html-to-image";
import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";

const IMAGE_WIDTH = 1600;
const IMAGE_HEIGHT = 1000;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const PADDING = 0.12;
const DEFAULT_BACKGROUND = "#0f1115";

function triggerDownload(dataUrl: string, fileName: string): void {
  const link = document.createElement("a");
  link.setAttribute("download", fileName);
  link.setAttribute("href", dataUrl);
  link.click();
}

/** Sanitize a workflow name into a safe file stem. */
export function exportFileStem(name: string | undefined): string {
  const base = (name ?? "workflow").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "workflow";
}

/**
 * Export the current canvas as a PNG download. Fits the whole graph (all
 * `nodes`) into a fixed-size image. Throws if there's nothing to export or the
 * canvas isn't mounted, so the caller can surface a message.
 */
export async function exportWorkflowPng(opts: {
  nodes: Node[];
  fileName: string;
  background?: string;
}): Promise<void> {
  const { nodes, fileName, background = DEFAULT_BACKGROUND } = opts;
  if (nodes.length === 0) {
    throw new Error("Nothing to export — the canvas is empty.");
  }
  const viewportEl = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewportEl) {
    throw new Error("Canvas isn't ready yet.");
  }

  const bounds = getNodesBounds(nodes);
  const viewport = getViewportForBounds(bounds, IMAGE_WIDTH, IMAGE_HEIGHT, MIN_ZOOM, MAX_ZOOM, PADDING);

  const dataUrl = await toPng(viewportEl, {
    backgroundColor: background,
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    style: {
      width: `${IMAGE_WIDTH}px`,
      height: `${IMAGE_HEIGHT}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
  });

  triggerDownload(dataUrl, fileName);
}
