/**
 * HEL-687 — sticky-note (canvas annotation) helpers. Annotations document the
 * graph; they are NOT steps (the engine ignores them). Persisted on the template
 * and rendered as a ViewportPortal overlay (StickyNotesLayer) so they pan/zoom
 * with the canvas without touching the React Flow node pipeline.
 */
import type { WorkflowAnnotation } from "../types/workflow";

export interface AnnotationColor {
  id: string;
  label: string;
  /** Card background. */
  bg: string;
  /** Card border. */
  border: string;
}

/** A small fixed palette (n8n-style). `id` is what's persisted as annotation.color. */
export const ANNOTATION_COLORS: AnnotationColor[] = [
  { id: "amber", label: "Amber", bg: "#fef3c7", border: "#fcd34d" },
  { id: "rose", label: "Rose", bg: "#ffe4e6", border: "#fda4af" },
  { id: "sky", label: "Sky", bg: "#e0f2fe", border: "#7dd3fc" },
  { id: "green", label: "Green", bg: "#dcfce7", border: "#86efac" },
  { id: "violet", label: "Violet", bg: "#ede9fe", border: "#c4b5fd" },
  { id: "slate", label: "Slate", bg: "#f1f5f9", border: "#cbd5e1" },
];

export const DEFAULT_ANNOTATION_COLOR = ANNOTATION_COLORS[0].id;

export function annotationColor(id: string): AnnotationColor {
  return ANNOTATION_COLORS.find((c) => c.id === id) ?? ANNOTATION_COLORS[0];
}

export const ANNOTATION_MIN_WIDTH = 160;
export const ANNOTATION_MIN_HEIGHT = 100;
const DEFAULT_WIDTH = 240;
const DEFAULT_HEIGHT = 160;

/** crypto.randomUUID — no Date.now() collisions under rapid creation. */
export function makeAnnotationId(): string {
  return `note-${crypto.randomUUID()}`;
}

export function isAnnotationId(id: string): boolean {
  return id.startsWith("note-");
}

/** A fresh sticky note at the given flow-space position. */
export function createAnnotation(position: { x: number; y: number }): WorkflowAnnotation {
  return {
    id: makeAnnotationId(),
    text: "",
    color: DEFAULT_ANNOTATION_COLOR,
    x: Math.round(position.x),
    y: Math.round(position.y),
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
}
