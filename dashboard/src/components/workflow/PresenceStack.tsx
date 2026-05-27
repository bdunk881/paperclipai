/**
 * PresenceStack — overlapping avatar circles for active peers (HEL-241C).
 *
 * Renders a small row of colored circles in the Studio header showing
 * who else has the routine open. Each avatar carries the peer's first
 * initial and uses their stable per-user color (computed server-side
 * in presenceStore.colorForUser).
 *
 * Up to MAX_VISIBLE avatars render explicitly; the rest collapse into
 * a "+N" pill so the header stays compact. Hovering an avatar shows
 * the peer's display name + the step they're currently focused on
 * (if any).
 */
import type { WorkflowPresencePeer } from "../../api/workflowsApi";

const MAX_VISIBLE = 4;

interface PresenceStackProps {
  peers: WorkflowPresencePeer[];
  /** Map of step ids → step names. Used for the hover tooltip. */
  stepNames?: Record<string, string>;
}

export function PresenceStack({ peers, stepNames }: PresenceStackProps) {
  if (peers.length === 0) return null;
  const visible = peers.slice(0, MAX_VISIBLE);
  const overflow = peers.length - visible.length;
  return (
    <div
      className="flex items-center -space-x-1.5"
      data-testid="workflow-presence-stack"
    >
      {visible.map((peer) => (
        <PeerDot key={peer.userId} peer={peer} stepNames={stepNames} />
      ))}
      {overflow > 0 && (
        <span
          className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full border-2 border-af2-card bg-af2-paper-3 px-1.5 text-[10px] font-semibold text-af2-ink-2"
          title={`${overflow} more`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function PeerDot({
  peer,
  stepNames,
}: {
  peer: WorkflowPresencePeer;
  stepNames?: Record<string, string>;
}) {
  const initial = (peer.name || "?").charAt(0).toUpperCase();
  const focusLine = peer.selectedStepId
    ? `viewing ${stepNames?.[peer.selectedStepId] ?? peer.selectedStepId}`
    : "browsing the canvas";
  return (
    <span
      title={`${peer.name} — ${focusLine}`}
      style={{ backgroundColor: peer.color }}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-af2-card text-[10px] font-bold text-white shadow-sm"
    >
      {initial}
    </span>
  );
}
