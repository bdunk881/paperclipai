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
import { listAgents } from "../api/agentApi";
import {
  getTicketActorProfile,
  hydrateTicketActorProfiles,
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
  const { getAccessToken, user } = useAuth();
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "mock" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const [response, agents] = await Promise.all([
        listTickets({}, accessToken),
        accessToken ? listAgents(accessToken).catch(() => []) : Promise.resolve([]),
      ]);
      hydrateTicketActorProfiles({ agents, user });
      setTickets(response.tickets);
      setSource(response.source);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load team view",
      );
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, user]);

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
          <h1 className="af2-h1 mt-1.5 font-af2-serif">
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
            className="af2-btn af2-btn-ghost af2-btn-sm no-underline"
          >
            ← Back to queue
          </Link>
          <button
            type="button"
            onClick={() => {
              void load();
            }}
            className="af2-btn af2-btn-sm inline-flex items-center gap-1.5"
            aria-label="Refresh team view"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      <TicketSourceNotice source={source} />

      {loading ? (
        <div className="af2-card p-10 text-center">
          <Loader2 className="mx-auto mb-3 animate-spin opacity-50" />
          <p className="af2-muted">Loading team view…</p>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-[var(--af2-radius)] border border-[rgba(192,84,76,0.30)] bg-[rgba(192,84,76,0.10)] px-4 py-3 text-[13px] text-af2-clay"
        >
          {error}
        </div>
      ) : actorCounts.length === 0 ? (
        <TicketEmptyState
          title="No team activity yet"
          body="Hand off work to an agent to start the team queue."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
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
    <section className="af2-card p-4">
      <div className="af2-eyebrow inline-flex items-center gap-1.5">
        {icon}
        {title}
      </div>
      <p className="af2-muted mt-1.5 text-xs">
        {body}
      </p>

      {actors.length === 0 ? (
        <p className="af2-muted-2 mt-4 text-center text-xs">
          No {title.toLowerCase()} in the queue.
        </p>
      ) : (
        <div className="mt-3.5 grid gap-2">
          {actors.map((actor) => {
            const profile = getTicketActorProfile(actor);
            return (
              <Link
                key={`${actor.type}:${actor.id}`}
                to={`/mission-assignments/actors/${actor.type}/${actor.id}`}
                className="af2-card block border-af2-line p-3.5 text-inherit no-underline"
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <div className="font-af2-serif text-[15px] font-semibold text-af2-ink">
                      {profile.name}
                    </div>
                    <div className="af2-mono af2-muted-2 mt-1 text-[10.5px] uppercase tracking-[0.08em]">
                      {profile.title}
                    </div>
                  </div>
                  <span className="af2-pill shrink-0 text-[11px]">
                    {actor.total} total
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-4 gap-1.5">
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
      className="rounded-lg border px-1.5 py-2 text-center"
      // Tone colors are data-derived; static spacing and type stay in classes.
      style={{
        borderColor: bg,
        background: bg,
      }}
    >
      <div
        className="af2-mono text-[10px] uppercase tracking-[0.06em]"
        style={{
          color: fg,
        }}
      >
        {label}
      </div>
      <div
        className="mt-0.5 text-base font-semibold"
        style={{
          color: fg,
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
