/**
 * Hire page (HEL-23) — mission intake UI.
 *
 * Captures a free-text mission statement plus four optional structured
 * prompts (industry, target customer, success metric, runway) and persists
 * to `missions` via POST /api/missions. Reference design:
 * `Projects/AutoFlow/v2/pages.jsx::AF2_Hire`.
 *
 * After save, the user can immediately trigger HEL-24's plan generator
 * (`POST /api/missions/:id/generate-plan`). The org chart + plan-card UI
 * that consumes the generated plan is HEL-25/HEL-26 work, not part of this
 * ticket — when no hiring plan exists yet, this page shows a placeholder
 * that links onward.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  createMission,
  generateHiringPlan,
  listMissions,
  type Mission,
  type MissionMetadata,
} from "../api/missionsApi";

type SubmitState = "idle" | "saving" | "generating" | "error";

const STATEMENT_MAX = 4000;

const STRUCTURED_FIELDS: Array<{
  key: keyof MissionMetadata;
  label: string;
  placeholder: string;
  helper: string;
}> = [
  {
    key: "industry",
    label: "Industry",
    placeholder: "Industrial robotics",
    helper: "Anchors role suggestions to a vertical.",
  },
  {
    key: "targetCustomer",
    label: "Target customer",
    placeholder: "OEM purchasing managers in the US",
    helper: "Helps shape the SDR + content roles.",
  },
  {
    key: "successMetric",
    label: "Success metric",
    placeholder: "200 demos by Q4",
    helper: "Defines what 'shipped' looks like.",
  },
  {
    key: "runway",
    label: "Budget / runway",
    placeholder: "$250k over 6 months",
    helper: "Caps the total team budget the planner allocates.",
  },
];

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function previewPrompt(statement: string, metadata: MissionMetadata): string {
  const lines: string[] = [];
  lines.push("Mission:");
  lines.push(statement || "(none yet)");
  const meta: string[] = [];
  if (metadata.industry) meta.push(`Industry: ${metadata.industry}`);
  if (metadata.targetCustomer) meta.push(`Target customer: ${metadata.targetCustomer}`);
  if (metadata.successMetric) meta.push(`Success metric: ${metadata.successMetric}`);
  if (metadata.runway) meta.push(`Budget: ${metadata.runway}`);
  if (meta.length > 0) {
    lines.push("");
    lines.push("Context:");
    for (const line of meta) lines.push(`- ${line}`);
  }
  return lines.join("\n");
}

export default function Hire() {
  const { requireAccessToken } = useAuth();
  const [statement, setStatement] = useState("");
  const [metadata, setMetadata] = useState<MissionMetadata>({});
  const [missions, setMissions] = useState<Mission[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const refreshMissions = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const token = await requireAccessToken();
      const rows = await listMissions(token);
      setMissions(rows);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load missions");
    } finally {
      setLoadingList(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void refreshMissions();
  }, [refreshMissions]);

  const trimmedStatement = statement.trim();
  const isBusy = submitState === "saving" || submitState === "generating";
  const canSave = trimmedStatement.length > 0 && !isBusy;
  const canGenerate = trimmedStatement.length > 0 && !isBusy;
  const charactersLeft = STATEMENT_MAX - statement.length;
  const preview = useMemo(
    () => previewPrompt(trimmedStatement, metadata),
    [trimmedStatement, metadata],
  );

  function updateMetadata<K extends keyof MissionMetadata>(key: K, value: string) {
    setMetadata((current) => ({ ...current, [key]: value }));
  }

  async function handleSave(generateAfter: boolean): Promise<void> {
    if (!trimmedStatement) {
      setError("Type a mission statement before saving.");
      setSubmitState("error");
      return;
    }
    setSubmitState(generateAfter ? "generating" : "saving");
    setError(null);
    setNotice(null);

    try {
      const token = await requireAccessToken();
      const created = await createMission(
        { statement: trimmedStatement, metadata: scrubEmptyMetadata(metadata) },
        token,
      );
      setMissions((current) => [created, ...current]);

      if (generateAfter) {
        try {
          await generateHiringPlan(created.id, token);
          setNotice(
            "Mission saved and hiring plan generated. The plan card on the Team page will pick it up.",
          );
        } catch (planErr) {
          // Mission already exists; the plan generator step failed. Surface
          // the error so the user knows the partial state.
          const planMsg = planErr instanceof Error ? planErr.message : String(planErr);
          setNotice(
            `Mission saved as draft, but plan generation failed: ${planMsg}. You can retry from the missions list below.`,
          );
        }
      } else {
        setNotice("Mission saved as a draft. Generate the hiring plan when you're ready.");
      }

      setStatement("");
      setMetadata({});
      void refreshMissions();
      setSubmitState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save mission");
      setSubmitState("error");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 text-af2-ink">
      <header className="mb-8">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-af2-ink-3">
          Workforce · Hiring
        </span>
        <h1 className="mt-1 font-af2-serif text-4xl font-normal leading-tight tracking-[-0.02em]">
          Hire from a mission.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-af2-ink-2">
          Tell AutoFlow what you need done. We'll draft an org, a budget, and the first week of
          work.
        </p>
      </header>

      {notice ? (
        <div className="mb-4 rounded-md border border-af2-sage/40 bg-af2-sage/10 px-4 py-3 text-sm text-af2-sage">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-md border border-af2-clay/40 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay"
        >
          {error}
        </div>
      ) : null}

      {/* Mission statement card */}
      <section className="rounded-xl border border-af2-line bg-af2-card p-6">
        <label
          htmlFor="mission-statement"
          className="text-[11px] font-medium uppercase tracking-[0.14em] text-af2-ink-3"
        >
          Mission statement
        </label>
        <textarea
          id="mission-statement"
          value={statement}
          onChange={(e) => setStatement(e.target.value.slice(0, STATEMENT_MAX))}
          placeholder="Launch the Acme R-7 robotic arm to industrial buyers in North America by Q4."
          rows={4}
          className="mt-2 w-full resize-y rounded-md border border-af2-line-2 bg-af2-card px-4 py-3 font-af2-serif text-lg leading-snug text-af2-ink outline-none transition focus:border-af2-clay focus:ring-2 focus:ring-af2-clay/20"
          disabled={submitState === "saving" || submitState === "generating"}
        />
        <div className="mt-1 text-right text-[11px] text-af2-ink-3">
          {charactersLeft} of {STATEMENT_MAX} characters left
        </div>

        {/* Structured prompts */}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {STRUCTURED_FIELDS.map((field) => (
            <div key={field.key}>
              <label
                htmlFor={`metadata-${field.key}`}
                className="text-[11px] font-medium uppercase tracking-[0.14em] text-af2-ink-3"
              >
                {field.label}{" "}
                <span className="ml-1 font-normal normal-case tracking-normal text-af2-ink-4">
                  optional
                </span>
              </label>
              <input
                id={`metadata-${field.key}`}
                type="text"
                value={metadata[field.key] ?? ""}
                onChange={(e) => updateMetadata(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="mt-1.5 w-full rounded-md border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink outline-none transition focus:border-af2-clay focus:ring-2 focus:ring-af2-clay/20"
                disabled={submitState === "saving" || submitState === "generating"}
              />
              <p className="mt-1 text-[11px] leading-snug text-af2-ink-3">{field.helper}</p>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="text-xs text-af2-ink-3">
            Saved missions stay in this workspace. Generate the plan when you're ready.
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => void handleSave(false)}
            disabled={!canSave}
            className="inline-flex items-center gap-2 rounded-md border border-af2-line-2 bg-af2-card px-4 py-2 text-sm font-medium text-af2-ink-2 transition hover:border-af2-clay/40 hover:text-af2-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitState === "saving" ? <Loader2 size={14} className="animate-spin" /> : null}
            Save draft
          </button>
          <button
            type="button"
            onClick={() => void handleSave(true)}
            disabled={!canGenerate}
            className="inline-flex items-center gap-2 rounded-md bg-af2-clay px-4 py-2 text-sm font-medium text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_6px_16px_rgba(194,80,43,0.25)] transition hover:bg-af2-clay-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitState === "generating" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {submitState === "generating" ? "Generating…" : "Save & generate plan →"}
          </button>
        </div>
      </section>

      {/* Inline LLM preview */}
      {trimmedStatement.length > 0 ? (
        <section className="mt-6 rounded-xl border border-dashed border-af2-line bg-af2-paper-2/40 p-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-af2-ink-3">
            How we'll brief the planner
          </div>
          <pre className="mt-2 whitespace-pre-wrap font-af2-mono text-[12.5px] leading-6 text-af2-ink-2">
            {preview}
          </pre>
        </section>
      ) : null}

      {/* Saved missions list */}
      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-af2-serif text-2xl font-medium tracking-[-0.015em] text-af2-ink">
            Saved missions
          </h2>
          <button
            type="button"
            onClick={() => void refreshMissions()}
            className="text-xs font-medium text-af2-clay hover:underline disabled:opacity-50"
            disabled={loadingList}
          >
            {loadingList ? "Loading…" : "Refresh"}
          </button>
        </div>

        {listError ? (
          <div className="rounded-md border border-af2-clay/40 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay">
            {listError}
          </div>
        ) : null}

        {!listError && missions.length === 0 && !loadingList ? (
          <div className="rounded-md border border-dashed border-af2-line bg-af2-paper p-6 text-center">
            <p className="font-af2-serif text-base text-af2-ink-2">
              No missions yet. Save your first one above to get started.
            </p>
          </div>
        ) : null}

        {missions.length > 0 ? (
          <ul className="space-y-2.5">
            {missions.map((mission) => (
              <li
                key={mission.id}
                className="rounded-md border border-af2-line bg-af2-card p-4 transition hover:border-af2-line-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-af2-serif text-base leading-snug text-af2-ink">
                      {mission.statement}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-af2-ink-3">
                      <span>{mission.companyName}</span>
                      <span className="text-af2-line-2">·</span>
                      <span>{mission.status}</span>
                      <span className="text-af2-line-2">·</span>
                      <span>{formatRelative(mission.createdAt)}</span>
                      {mission.latestHiringPlanId ? (
                        <>
                          <span className="text-af2-line-2">·</span>
                          <span className="text-af2-sage">plan drafted</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {mission.latestHiringPlanId ? (
                      <Link
                        to="/team"
                        className="rounded-md border border-af2-line-2 px-2.5 py-1 text-[11px] font-medium text-af2-ink-2 transition hover:border-af2-clay/40 hover:text-af2-ink"
                      >
                        View plan
                      </Link>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function scrubEmptyMetadata(input: MissionMetadata): MissionMetadata {
  const out: MissionMetadata = {};
  if (input.industry?.trim()) out.industry = input.industry.trim();
  if (input.targetCustomer?.trim()) out.targetCustomer = input.targetCustomer.trim();
  if (input.successMetric?.trim()) out.successMetric = input.successMetric.trim();
  if (input.runway?.trim()) out.runway = input.runway.trim();
  return out;
}
