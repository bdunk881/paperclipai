import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Bot, RefreshCw, UserRound } from "lucide-react";
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
import { aggregateActorCounts } from "./tickets/ticketingUtils";

export default function TicketTeamView() {
  const { getAccessToken } = useAuth();
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"api" | "mock">("mock");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const response = await listTickets({}, accessToken);
      setTickets(response.tickets);
      setSource(response.source);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load team view");
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
    <div className="min-h-full bg-[#0b1120] text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <section className="rounded-[30px] border border-slate-800/80 bg-slate-950/85 px-6 py-6 md:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <Link
                to="/tickets"
                className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-slate-100"
              >
                <ArrowLeft size={14} />
                Back to queue
              </Link>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-100">Team Ticket View</h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Agents and humans side-by-side with live counts by status so ownership drift is obvious before it becomes a problem.
              </p>
            </div>

            <button
              onClick={() => {
                void load();
              }}
              className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-indigo-500/30 hover:text-slate-100"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>

          <div className="mt-5">
            <TicketSourceNotice source={source} />
          </div>
        </section>

        {loading ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="scanline-skeleton min-h-[340px] rounded-[28px]" />
            <div className="scanline-skeleton min-h-[340px] rounded-[28px]" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : actorCounts.length === 0 ? (
          <TicketEmptyState
            title="No team activity yet"
            body="Create a ticket to start building the team-wide queue view."
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <ActorColumn
              title="Agents"
              body="Operational workload for autonomous teammates."
              actors={agents}
              icon={<Bot size={15} />}
            />
            <ActorColumn
              title="Humans"
              body="Hand-offs, PM review, and customer-facing ownership."
              actors={humans}
              icon={<UserRound size={15} />}
            />
          </div>
        )}
      </div>
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
    <section className="rounded-[30px] border border-slate-800 bg-slate-950/80 p-5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {icon}
        {title}
      </div>
      <p className="mt-3 text-sm text-slate-400">{body}</p>

      <div className="mt-5 space-y-3">
        {actors.map((actor) => {
          const profile = getTicketActorProfile(actor);
          return (
            <Link
              key={`${actor.type}:${actor.id}`}
              to={`/tickets/actors/${actor.type}/${actor.id}`}
              className="block rounded-[24px] border border-slate-800 bg-slate-900/70 px-4 py-4 transition hover:border-teal-500/30 hover:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-slate-100">{profile.name}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                    {profile.title}
                  </p>
                </div>
                <span className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-400">
                  {actor.total} total
                </span>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                <CountPill label="Open" value={actor.open} />
                <CountPill label="Active" value={actor.in_progress} tone="teal" />
                <CountPill label="Blocked" value={actor.blocked} tone="orange" />
                <CountPill label="Done" value={actor.resolved} tone="slate" />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function CountPill({
  label,
  value,
  tone = "indigo",
}: {
  label: string;
  value: number;
  tone?: "indigo" | "teal" | "orange" | "slate";
}) {
  const toneClass =
    tone === "teal"
      ? "border-teal-500/30 bg-teal-500/10 text-teal-200"
      : tone === "orange"
        ? "border-orange-500/30 bg-orange-500/10 text-orange-200"
        : tone === "slate"
          ? "border-slate-700 bg-slate-950/80 text-slate-300"
          : "border-indigo-500/30 bg-indigo-500/10 text-indigo-200";

  return (
    <div className={`rounded-2xl border px-2 py-3 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
