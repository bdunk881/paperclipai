/**
 * WorkflowCursors — live peer cursor overlay (HEL-241C v2).
 *
 * Renders a small triangular cursor + name label for every peer that
 * has reported a cursor position. Positioned inside ReactFlow's
 * <ViewportPortal> so coordinates are interpreted in flow space —
 * panning + zooming the canvas keeps the cursors stuck to the same
 * underlying point.
 *
 * Cursor SVG is tiny (16x16) and uses the peer's stable color so the
 * cursor and the peer's avatar in PresenceStack visually match. The
 * label is `pointer-events: none` everywhere so peer cursors never
 * intercept clicks meant for the canvas.
 */
import { ViewportPortal } from "@xyflow/react";
import type { WorkflowPresencePeer } from "../../api/workflowsApi";

interface WorkflowCursorsProps {
  peers: WorkflowPresencePeer[];
}

export function WorkflowCursors({ peers }: WorkflowCursorsProps) {
  const withCursor = peers.filter(
    (p): p is WorkflowPresencePeer & { cursor: { x: number; y: number } } =>
      p.cursor != null &&
      Number.isFinite(p.cursor.x) &&
      Number.isFinite(p.cursor.y),
  );
  if (withCursor.length === 0) return null;
  return (
    <ViewportPortal>
      <div
        className="pointer-events-none absolute inset-0"
        data-testid="workflow-cursors-layer"
      >
        {withCursor.map((peer) => (
          <PeerCursor key={peer.userId} peer={peer} />
        ))}
      </div>
    </ViewportPortal>
  );
}

function PeerCursor({
  peer,
}: {
  peer: WorkflowPresencePeer & { cursor: { x: number; y: number } };
}) {
  return (
    <div
      data-testid={`workflow-cursor-${peer.userId}`}
      className="pointer-events-none absolute will-change-transform"
      style={{
        transform: `translate(${peer.cursor.x}px, ${peer.cursor.y}px)`,
        // 100ms ease softens the discrete updates from the wire so
        // the cursor glides between samples instead of teleporting.
        transition: "transform 100ms linear",
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        aria-hidden="true"
        style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.2))" }}
      >
        <path
          d="M2 2 L2 14 L6 10 L9 16 L11 15 L8 9 L14 9 Z"
          fill={peer.color}
          stroke="#ffffff"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="ml-3 mt-0.5 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
        style={{ backgroundColor: peer.color }}
      >
        {peer.name}
      </span>
    </div>
  );
}
