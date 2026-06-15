import { describe, it, expect } from "vitest";
import {
  createAnnotation,
  makeAnnotationId,
  isAnnotationId,
  annotationColor,
  ANNOTATION_COLORS,
  DEFAULT_ANNOTATION_COLOR,
} from "./workflowAnnotations";

describe("workflowAnnotations (HEL-687)", () => {
  it("createAnnotation yields a note-prefixed id, default color, rounded pos, default size", () => {
    const a = createAnnotation({ x: 10.6, y: 20.2 });
    expect(isAnnotationId(a.id)).toBe(true);
    expect(a.color).toBe(DEFAULT_ANNOTATION_COLOR);
    expect(a.x).toBe(11);
    expect(a.y).toBe(20);
    expect(a.width).toBeGreaterThan(0);
    expect(a.height).toBeGreaterThan(0);
    expect(a.text).toBe("");
  });

  it("makeAnnotationId mints unique, note-prefixed ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => makeAnnotationId()));
    expect(ids.size).toBe(200);
    expect([...ids].every(isAnnotationId)).toBe(true);
  });

  it("annotationColor resolves known ids and falls back for unknown", () => {
    expect(annotationColor("sky").id).toBe("sky");
    expect(annotationColor("nope")).toEqual(ANNOTATION_COLORS[0]);
  });
});
