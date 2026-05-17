/**
 * Team view — V2 editorial rebuild (DASH-19).
 *
 * Sub-route under Mission Assignments at /mission-assignments/team.
 * Shows side-by-side agent and human queue counts so ownership
 * drift is obvious before it becomes a problem.
 *
 * Used to render in the V1 indigo/teal glass-card design; now uses
 * af2-page / af2-card / af2-list primitives like the rest of the
 * /mission-assignments surface.
 *
 * Data layer unchanged from V1: `listTickets` + actor-count
 * aggregation. Sub-page link repointed off the legacy /tickets/*
 * redirect onto the canonical /mission-assignments/* path.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Loader2, RefreshCw, UserRound } from "lucide-react";
import {
  getTicketActorProfile,
  listTickets,
  type TicketRecord,
} from "../api/tickets";
import { useAuth } from "../context/AuthContext";
import {
  TicketEmptyState,
  TicketSourceNotice,
} from "./tickets/ticketingUi";
import { aggregateActorCounts } from "./tickets/ticketingUi.helpers";

export default function TicketTeamView() {
  const { getAccessToken } = useAuth();
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "mock" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const response = await listTickets({}, accessToken);
      setTickets(response.tickets);
      setSource(response.source);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load team view",
      );
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const actorCounts = useMemo(() => aggregateActorCounts(tickets), [tickets]);
  const agents = actorCounts.filter((actor) => actor.type === "agent");
  const humans = actorCounts.filter((actor) => actor.type === "user");

  return (
    <div className="af2-page text-af2-ink">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Run · Assignments · Team</div>
          <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Team assignment view
          </h1>
          <div className="af2-page-head-meta">
            Agents and humans side-by-side with live counts by status so
            ownership drift is obvious before it becomes a problem.
          </div>
        </div>
        <div className="af2-page-actions">
          <Link
            to="/mission-assignments"
            className="af2-btn af2-btn-ghost af2-btn-sm"
            style={{ textDecoration: "none" }}
          >
            ← Back to queue
          </Link>
          <button
            type="button"
            onClick={() => {
              void load();
            }}
            className="af2-btn af2-btn-sm"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            aria-label="Refresh team view"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      <TicketSourceNotice source={source} />

      {loading ? (
        <div className="af2-card" style={{ padding: 40, textAlign: "center" }}>
          <Loader2
            className="animate-spin"
            style={{ margin: "0 auto 12px", opacity: 0.5 }}
          />
          <p className="af2-muted">Loading team view…</p>
        </div>
      ) : error ? (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            borderRadius: "var(--af2-radius)",
            border: "1px solid rgba(192,84,76,0.30)",
            background: "rgba(192,84,76,0.10)",
            color: "var(--af2-clay)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : actorCounts.length === 0 ? (
        <TicketEmptyState
          title="No team activity yet"
          body="Hand off work to an agent to start the team queue."
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: 20,
          }}
        >
          <ActorColumn
            title="Agents"
            body="Operational workload for autonomous teammates."
            actors={agents}
            icon={<Bot size={13} />}
          />
          <ActorColumn
            title="Humans"
            body="Hand-offs, PM review, and customer-facing ownership."
            actors={humans}
            icon={<UserRound size={13} />}
          />
        </div>
      )}
    </div>
  );
}

function ActorColumn({
  title,
  body,
  actors,
  icon,
}: {
  title: string;
  body: string;
  actors: ReturnType<typeof aggregateActorCounts>;
  icon: React.ReactNode;
}) {
  return (
    <section className="af2-card" style={{ padding: 18 }}>
      <div
        className="af2-eyebrow"
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        {icon}
        {title}
      </div>
      <p className="af2-muted" style={{ fontSize: 12, marginTop: 6 }}>
        {body}
      </p>

      {actors.length === 0 ? (
        <p
          className="af2-muted-2"
          style={{ fontSize: 12, marginTop: 18, textAlign: "center" }}
        >
          No {title.toLowerCase()} in the queue.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {actors.map((actor) => {
            const profile = getTicketActorProfile(actor);
            return (
              <Link
                key={`${actor.type}:${actor.id}`}
                to={`/mission-assignments/actors/${actor.type}/${actor.id}`}
                className="af2-card"
                style={{
                  padding: 14,
                  textDecoration: "none",
                  color: "inherit",
                  borderColor: "var(--af2-line)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      className="font-af2-serif"
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: "var(--af2-ink)",
                      }}
                    >
                      {profile.name}
                    </div>
                    <div
                      className="af2-mono af2-muted-2"
                      style={{
                        fontSize: 10.5,
                        marginTop: 4,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}
                    >
                      {profile.title}
                    </div>
                  </div>
                  <span
                    className="af2-pill"
                    style={{ flexShrink: 0, fontSize: 11 }}
                  >
                    {actor.total} total
                  </span>
                </div>

                <div
                  style={{
                    marginTop: 12,
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 6,
                  }}
                >
                  <CountPill label="Open" value={actor.open} />
                  <CountPill label="Active" value={actor.in_progress} tone="sage" />
                  <CountPill label="Blocked" value={actor.blocked} tone="mustard" />
                  <CountPill label="Done" value={actor.resolved} tone="muted" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CountPill({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: number;
  tone?: "ink" | "sage" | "mustard" | "muted";
}) {
  const { fg, bg } = toneStyle(tone);
  return (
    <div
      style={{
        padding: "8px 6px",
        borderRadius: 8,
        border: `1px solid ${bg}`,
        background: bg,
        textAlign: "center",
      }}
    >
      <div
        className="af2-mono"
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: fg,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: fg,
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function toneStyle(tone: "ink" | "sage" | "mustard" | "muted"): {
  fg: string;
  bg: string;
} {
  if (tone === "sage") {
    return { fg: "var(--af2-sage, #4a6b4a)", bg: "rgba(74,107,74,0.10)" };
  }
  if (tone === "mustard") {
    return { fg: "var(--af2-mustard, #c08e3a)", bg: "rgba(192,142,58,0.10)" };
  }
  if (tone === "muted") {
    return { fg: "var(--af2-ink-3, #888)", bg: "rgba(0,0,0,0.04)" };
  }
  return { fg: "var(--af2-ink, #222)", bg: "rgba(0,0,0,0.05)" };
}
