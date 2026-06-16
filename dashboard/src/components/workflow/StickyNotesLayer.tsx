/**
 * HEL-687 — sticky-note canvas annotations.
 *
 * Rendered as a ViewportPortal overlay (like the peer-cursor layer) so notes
 * pan/zoom with the canvas WITHOUT entering the React Flow node array or its
 * controlled change pipeline — keeping all interaction logic isolated here. Drag
 * + resize are pointer-based, converting screen deltas to flow deltas via the
 * current zoom. Notes are persisted on the template (`annotations`); the engine
 * ignores them.
 *
 * V1 renders the note body as plain text (whitespace-preserved). Markdown
 * rendering + live Yjs collab-sync are tracked follow-ups.
 */
import { useEffect, useRef, useState } from "react";
import { ViewportPortal } from "@xyflow/react";
import { Trash2, GripVertical } from "lucide-react";
import { clsx } from "clsx";
import type { WorkflowAnnotation } from "../../types/workflow";
import {
  ANNOTATION_COLORS,
  ANNOTATION_MIN_HEIGHT,
  ANNOTATION_MIN_WIDTH,
  annotationColor,
} from "../../pages/workflowAnnotations";

export interface StickyNotesLayerProps {
  annotations: WorkflowAnnotation[];
  readonly: boolean;
  /** Current canvas zoom (screen px per flow unit) for pointer-delta conversion. */
  getZoom: () => number;
  onChange: (id: string, patch: Partial<WorkflowAnnotation>) => void;
  onDelete: (id: string) => void;
}

export function StickyNotesLayer({
  annotations,
  readonly,
  getZoom,
  onChange,
  onDelete,
}: StickyNotesLayerProps) {
  if (annotations.length === 0) return null;
  return (
    <ViewportPortal>
      {annotations.map((note) => (
        <StickyNote
          key={note.id}
          note={note}
          readonly={readonly}
          getZoom={getZoom}
          onChange={onChange}
          onDelete={onDelete}
        />
      ))}
    </ViewportPortal>
  );
}

interface StickyNoteProps {
  note: WorkflowAnnotation;
  readonly: boolean;
  getZoom: () => number;
  onChange: (id: string, patch: Partial<WorkflowAnnotation>) => void;
  onDelete: (id: string) => void;
}

function StickyNote({ note, readonly, getZoom, onChange, onDelete }: StickyNoteProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  // Live geometry during a drag/resize gesture; null when idle (use persisted).
  const [live, setLive] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const geom = live ?? note;
  const colors = annotationColor(note.color);

  function startDrag(e: React.PointerEvent): void {
    if (readonly || editing) return;
    e.preventDefault();
    e.stopPropagation();
    const zoom = getZoom() || 1;
    const startX = e.clientX;
    const startY = e.clientY;
    const base = { x: note.x, y: note.y, width: note.width, height: note.height };
    const onMove = (ev: PointerEvent): void => {
      setLive({
        ...base,
        x: Math.round(base.x + (ev.clientX - startX) / zoom),
        y: Math.round(base.y + (ev.clientY - startY) / zoom),
      });
    };
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onChange(note.id, {
        x: Math.round(base.x + (ev.clientX - startX) / zoom),
        y: Math.round(base.y + (ev.clientY - startY) / zoom),
      });
      setLive(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startResize(e: React.PointerEvent): void {
    if (readonly || editing) return;
    e.preventDefault();
    e.stopPropagation();
    const zoom = getZoom() || 1;
    const startX = e.clientX;
    const startY = e.clientY;
    const base = { x: note.x, y: note.y, width: note.width, height: note.height };
    const clampW = (w: number) => Math.max(ANNOTATION_MIN_WIDTH, Math.round(w));
    const clampH = (h: number) => Math.max(ANNOTATION_MIN_HEIGHT, Math.round(h));
    const onMove = (ev: PointerEvent): void => {
      setLive({
        ...base,
        width: clampW(base.width + (ev.clientX - startX) / zoom),
        height: clampH(base.height + (ev.clientY - startY) / zoom),
      });
    };
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onChange(note.id, {
        width: clampW(base.width + (ev.clientX - startX) / zoom),
        height: clampH(base.height + (ev.clientY - startY) / zoom),
      });
      setLive(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function commitText(): void {
    setEditing(false);
    if (draft !== note.text) onChange(note.id, { text: draft });
  }

  return (
    <div
      className="group absolute rounded-lg border shadow-sm"
      style={{
        transform: `translate(${geom.x}px, ${geom.y}px)`,
        width: geom.width,
        height: geom.height,
        backgroundColor: colors.bg,
        borderColor: colors.border,
      }}
      data-testid="sticky-note"
      data-note-id={note.id}
    >
      {/* Header: drag handle + color swatches + delete (hover/edit reveal). */}
      <div className="flex items-center justify-between px-1.5 py-1">
        <button
          type="button"
          className={clsx(
            "cursor-grab text-af2-ink-4/70 active:cursor-grabbing",
            readonly && "pointer-events-none opacity-0",
          )}
          title="Drag note"
          aria-label="Drag note"
          onPointerDown={startDrag}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        {!readonly && (
          <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.label}
                aria-label={`Color ${c.label}`}
                onClick={() => onChange(note.id, { color: c.id })}
                className={clsx(
                  "h-3 w-3 rounded-full border",
                  note.color === c.id ? "ring-1 ring-af2-ink/40" : "",
                )}
                style={{ backgroundColor: c.bg, borderColor: c.border }}
              />
            ))}
            <button
              type="button"
              title="Delete note"
              aria-label="Delete note"
              onClick={() => onDelete(note.id)}
              className="text-af2-ink-4/70 hover:text-af2-clay"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Body: plain-text note (double-click to edit). */}
      {editing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(note.text);
              setEditing(false);
            }
          }}
          className="h-[calc(100%-28px)] w-full resize-none bg-transparent px-2 pb-2 text-xs text-af2-ink outline-none"
          placeholder="Write a note…"
        />
      ) : (
        <div
          className="h-[calc(100%-28px)] w-full overflow-auto whitespace-pre-wrap px-2 pb-2 text-xs text-af2-ink"
          onDoubleClick={() => {
            if (readonly) return;
            setDraft(note.text);
            setEditing(true);
          }}
        >
          {note.text || (
            <span className="text-af2-ink-4/70">{readonly ? "" : "Double-click to edit"}</span>
          )}
        </div>
      )}

      {/* Bottom-right resize handle. */}
      {!readonly && (
        <div
          className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize"
          onPointerDown={startResize}
          title="Resize note"
        >
          <div className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 border-b border-r border-af2-ink-4/50" />
        </div>
      )}
    </div>
  );
}
