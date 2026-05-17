/**
 * AgentCardActions — the four-button row of agent-scoped quick
 * actions that should appear on every agent surface (OrgStructure
 * lead cards, OrgStructure report cards, future Agent Detail page,
 * etc.).
 *
 * Actions:
 *   - Check in now    → POST /api/agents/:id/check-in (Wave 5)
 *   - Hand off…       → opens HandoffModal (Wave 5)
 *   - Job description → link to /agents/:id/job (Wave 3)
 *   - Standing tasks  → link to /agents/:id/standing-tasks (Wave 4)
 *
 * `compact={true}` renders icon-only buttons (for the smaller report
 * cards under each lead); `compact={false}` renders icon + text labels
 * (for full lead cards). Both variants share the same modal + state.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Loader2, Send, Sparkles, Zap } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { checkInAgent } from "../api/agentActionsApi";
import { HandoffModal } from "./HandoffModal";

interface Props {
  agent: { id: string; name: string };
  compact?: boolean;
}

type ActionState = "idle" | "checking-in" | "sent" | "error";

export function AgentCardActions({ agent, compact = false }: Props) {
  const { requireAccessToken } = useAuth();
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [state, setState] = useState<ActionState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleCheckIn(): Promise<void> {
    setState("checking-in");
    setError(null);
    try {
      const token = await requireAccessToken();
      await checkInAgent(agent.id, token);
      setState("sent");
      window.setTimeout(() => {
        setState((s) => (s === "sent" ? "idle" : s));
      }, 3_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check-in failed");
      setState("error");
    }
  }

  const Btn = compact ? IconButton : LabeledButton;

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: compact ? 2 : 6,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Btn
          icon={state === "checking-in" ? Loader2 : Zap}
          spinning={state === "checking-in"}
          label={state === "checking-in" ? "Checking in…" : "Check in now"}
          title={`Wake ${agent.name} to review current work and unblock self`}
          disabled={state === "checking-in"}
          onClick={(e) => {
            e.preventDefault();
            void handleCheckIn();
          }}
        />
        <Btn
          icon={Send}
          label="Hand off…"
          title={`Assign a new task to ${agent.name}`}
          onClick={(e) => {
            e.preventDefault();
            setHandoffOpen(true);
          }}
        />
        <BtnLink
          to={`/agents/${agent.id}/job`}
          icon={Sparkles}
          label="Job description"
          title={`Edit ${agent.name}'s job description`}
          compact={compact}
        />
        <BtnLink
          to={`/agents/${agent.id}/standing-tasks`}
          icon={ClipboardList}
          label="Standing tasks"
          title={`Manage ${agent.name}'s standing tasks`}
          compact={compact}
        />
        {state === "sent" ? (
          <span
            className="af2-muted"
            style={{ fontSize: 11, color: "var(--af2-sage)" }}
          >
            ✓ Sent
          </span>
        ) : null}
        {state === "error" && error ? (
          <span
            className="af2-muted"
            style={{ fontSize: 11, color: "var(--af2-clay)" }}
            title={error}
          >
            Failed
          </span>
        ) : null}
      </div>

      <HandoffModal
        agentId={agent.id}
        agentName={agent.name}
        open={handoffOpen}
        onClose={() => setHandoffOpen(false)}
        onHandedOff={() => {
          setState("sent");
          window.setTimeout(() => {
            setState((s) => (s === "sent" ? "idle" : s));
          }, 3_000);
        }}
      />
    </>
  );
}

// Use lucide-react's LucideIcon shape directly — its ForwardRefExotic
// type isn't assignable to a plain ComponentType<{size}> due to the
// extra ref + LucideProps surface.
type IconType = React.ComponentType<{
  size?: number | string;
  className?: string;
}>;

interface BtnProps {
  icon: IconType;
  label: string;
  title: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  spinning?: boolean;
}

function LabeledButton({ icon: Icon, label, title, onClick, disabled, spinning }: BtnProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="af2-btn af2-btn-sm af2-btn-ghost"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Icon size={12} className={spinning ? "animate-spin" : undefined} />
      {label}
    </button>
  );
}

function IconButton({ icon: Icon, label, title, onClick, disabled, spinning }: BtnProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        padding: 0,
        border: "none",
        borderRadius: 4,
        background: "transparent",
        color: "var(--af2-muted)",
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.color = "var(--af2-ink)";
          e.currentTarget.style.background = "rgba(0,0,0,0.04)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--af2-muted)";
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon size={12} className={spinning ? "animate-spin" : undefined} />
    </button>
  );
}

interface BtnLinkProps {
  to: string;
  icon: IconType;
  label: string;
  title: string;
  compact: boolean;
}

function BtnLink({ to, icon: Icon, label, title, compact }: BtnLinkProps) {
  if (compact) {
    return (
      <Link
        to={to}
        title={title}
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          borderRadius: 4,
          color: "var(--af2-muted)",
          textDecoration: "none",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--af2-ink)";
          e.currentTarget.style.background = "rgba(0,0,0,0.04)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--af2-muted)";
          e.currentTarget.style.background = "transparent";
        }}
      >
        <Icon size={12} />
      </Link>
    );
  }
  return (
    <Link
      to={to}
      title={title}
      onClick={(e) => e.stopPropagation()}
      className="af2-btn af2-btn-sm af2-btn-ghost"
      style={{
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <Icon size={12} />
      {label}
    </Link>
  );
}
