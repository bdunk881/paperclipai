/**
 * Hire page (HEL-23, v2 refresh).
 *
 * Mission-intake screen styled to the v2 "Hire from a mission" reference in
 * `docs/design/v2/pages.jsx::AF2_Hire`: an editorial page-head, a single
 * `af2-card` that captures the mission statement plus four optional
 * structured prompts (industry, target customer, success metric, runway),
 * a readiness pill, and a "Past missions" list of prior briefs.
 *
 * Data flow is unchanged from the HEL-23 / HEL-24 / HEL-105 surface area:
 *   - `createMission` persists the draft via POST /api/missions
 *   - `generateHiringPlan` calls HEL-24's POST /api/missions/:id/generate-plan
 *   - On a successful generate, we navigate straight to the side-by-side
 *     review page at `/hire/plan/:missionId/:planId` (HiringPlanReview /
 *     HEL-105 owns the review surface). Inline confirmation lives there,
 *     not here, so a misclick on this page can't provision a team.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useToast } from "../components/ToastProvider";
import {
  createMission,
  deleteMission,
  generateHiringPlan,
  listMissions,
  type Mission,
  type MissionMetadata,
} from "../api/missionsApi";
import { listLLMConfigs, type LLMConfig } from "../api/client";

type SubmitState = "idle" | "saving" | "generating" | "error";

const STATEMENT_MAX = 4000;

const STRUCTURED_FIELDS: Array<{
  key: keyof MissionMetadata;
  label: string;
  placeholder: string;
}> = [
  { key: "industry", label: "Industry", placeholder: "Industrial robotics" },
  {
    key: "targetCustomer",
    label: "Target customer",
    placeholder: "OEM purchasing managers in the US",
  },
  { key: "successMetric", label: "Success metric", placeholder: "200 demos by Q4" },
  { key: "runway", label: "Budget / runway", placeholder: "$250k over 6 months" },
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

/**
 * Cheap readiness score so the readiness pill in the v2 design has
 * something to render. We weight the mission statement heavily (it's the
 * only required field) and give each structured prompt a smaller bump.
 * Returns a [0, 1] number; the surrounding copy switches at thresholds.
 */
function computeReadiness(statement: string, metadata: MissionMetadata): number {
  const trimmed = statement.trim();
  if (trimmed.length === 0) return 0;
  const statementScore = Math.min(trimmed.length / 80, 1) * 0.6;
  const filled = [
    metadata.industry,
    metadata.targetCustomer,
    metadata.successMetric,
    metadata.runway,
  ].filter((v) => (v ?? "").trim().length > 0).length;
  const metadataScore = (filled / 4) * 0.4;
  return Math.min(1, Number((statementScore + metadataScore).toFixed(2)));
}

function readinessLabel(score: number): string {
  if (score === 0) return "Draft a mission to get started";
  if (score < 0.5) return "Add a few more details";
  if (score < 0.8) return "Almost there";
  return "Ready for plan";
}

export default function Hire() {
  const { requireAccessToken } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [statement, setStatement] = useState("");
  const [metadata, setMetadata] = useState<MissionMetadata>({});
  const [missions, setMissions] = useState<Mission[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  // Per-row in-flight + error state for delete. Keyed by missionId so
  // two simultaneous deletes never collide on a shared spinner.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Gate the Generate button on having at least one LLM credential. Without
  // one, the backend's POST /api/missions/:id/generate-plan returns 422
  // ("No LLM provider configured"). We surface the gap up front so the user
  // doesn't fill out the whole form and then bounce off an error.
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[] | null>(null);
  const [llmConfigError, setLlmConfigError] = useState<string | null>(null);
  const hasLLM = (llmConfigs?.length ?? 0) > 0;
  const llmCheckLoading = llmConfigs === null && llmConfigError === null;

  async function handleDelete(mission: Mission): Promise<void> {
    // Native confirm() is fine for Wave 1 — fast path, clear copy,
    // no modal infra needed. Confirmed-plan refusal is shaped on the
    // backend (409 with explanation); we surface that error string
    // verbatim so the user knows to retire the team first.
    const ok = window.confirm(
      `Discard this mission?\n\n"${mission.statement.slice(0, 140)}${
        mission.statement.length > 140 ? "…" : ""
      }"\n\nAny draft hiring plan attached to it will also be deleted. This can't be undone.`,
    );
    if (!ok) return;

    setDeletingId(mission.id);
    setDeleteError(null);
    try {
      const token = await requireAccessToken();
      await deleteMission(mission.id, token);
      // Optimistic prune — list reflects the removal immediately while
      // the background refresh confirms it from the server.
      setMissions((current) => current.filter((m) => m.id !== mission.id));
      void refreshMissions();
      toast.success("Mission discarded.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete mission";
      // Keep the inline error too — the 409 ("confirmed plan") message
      // is long and important enough that a passing toast isn't
      // sufficient on its own.
      setDeleteError(msg);
      toast.error(msg);
    } finally {
      setDeletingId(null);
    }
  }

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await requireAccessToken();
        const list = await listLLMConfigs(token);
        if (!cancelled) setLlmConfigs(list);
      } catch (err) {
        if (!cancelled) {
          setLlmConfigError(err instanceof Error ? err.message : "Failed to check LLM models");
          setLlmConfigs([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requireAccessToken]);

  const trimmedStatement = statement.trim();
  const isBusy = submitState === "saving" || submitState === "generating";
  const canSave = trimmedStatement.length > 0 && !isBusy;
  // Generate is gated on LLM credentials. Save-as-draft stays available so a
  // user without a model can still capture mission ideas now and generate
  // later once they connect a provider.
  const canGenerate = trimmedStatement.length > 0 && !isBusy && hasLLM && !llmCheckLoading;
  const charactersLeft = STATEMENT_MAX - statement.length;
  const readiness = useMemo(
    () => computeReadiness(statement, metadata),
    [statement, metadata],
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
          const plan = await generateHiringPlan(created.id, token);
          // HEL-105: jump straight to the side-by-side review page so the
          // user can scan mission ↔ plan ↔ agents in one screen before
          // confirming. The Hire page deliberately doesn't render the
          // generated plan inline.
          setSubmitState("idle");
          navigate(`/hire/plan/${created.id}/${plan.hiringPlanId}`);
          return;
        } catch (planErr) {
          const planMsg = planErr instanceof Error ? planErr.message : String(planErr);
          // Keep this one inline — the failure message includes a
          // multi-line "you can retry from past missions below"
          // pointer that loses context as a fly-by toast.
          setNotice(
            `Mission saved as a draft, but plan generation failed: ${planMsg}. You can retry from past missions below.`,
          );
          toast.error(`Plan generation failed for ${created.statement.slice(0, 60)}…`);
        }
      } else {
        toast.success("Mission saved as a draft.");
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
    <div className="af2-page text-af2-ink" style={{ maxWidth: 920 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce · Hiring</div>
          <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Hire from a mission.
          </h1>
          <div className="af2-page-head-meta">
            Tell AutoFlow what you need done. We&rsquo;ll draft an org, a budget, and the
            first week of work.
          </div>
        </div>
      </div>

      {notice ? (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: "var(--af2-radius)",
            border: "1px solid rgba(74,107,74,0.25)",
            background: "rgba(74,107,74,0.10)",
            color: "var(--af2-sage)",
            fontSize: 13,
          }}
        >
          {notice}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: "var(--af2-radius)",
            border: "1px solid rgba(194,80,43,0.3)",
            background: "rgba(194,80,43,0.10)",
            color: "var(--af2-clay)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Inline gate: if no LLM credentials exist yet, the backend's
          POST /api/missions/:id/generate-plan will fail with 422. Surface
          that up front rather than after a full form submission. */}
      {!llmCheckLoading && !hasLLM ? (
        <div
          className="af2-card"
          style={{
            padding: 16,
            marginBottom: 14,
            borderColor: "var(--af2-mustard)",
            background: "color-mix(in srgb, var(--af2-mustard) 10%, var(--af2-card))",
          }}
        >
          <div className="af2-row" style={{ alignItems: "flex-start", gap: 12 }}>
            <Sparkles size={18} style={{ color: "var(--af2-mustard)", marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                Connect a model before you can generate a hiring plan
              </div>
              <div
                className="af2-muted"
                style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}
              >
                AutoFlow uses your own API key to draft the org chart, budget, and first
                week of work. Add an OpenAI, Anthropic, or other provider key in Models,
                then come back here.
              </div>
              {llmConfigError ? (
                <div
                  className="af2-mono"
                  style={{ fontSize: 11.5, color: "var(--af2-clay)", marginTop: 6 }}
                >
                  {llmConfigError}
                </div>
              ) : null}
            </div>
            <Link
              to="/settings/llm-providers"
              className="af2-btn af2-btn-clay"
              style={{ flexShrink: 0 }}
            >
              Add a model →
            </Link>
          </div>
        </div>
      ) : null}

      {/* Mission statement card — v2 intake surface */}
      <div className="af2-card" style={{ padding: 22 }}>
        <label htmlFor="mission-statement" className="af2-eyebrow">
          Mission statement
        </label>
        <textarea
          id="mission-statement"
          className="af2-input"
          value={statement}
          onChange={(e) => setStatement(e.target.value.slice(0, STATEMENT_MAX))}
          placeholder="Launch the Acme R-7 robotic arm to industrial buyers in North America by Q4."
          rows={3}
          style={{
            width: "100%",
            marginTop: 8,
            fontSize: 16,
            fontFamily: "var(--af2-serif)",
            lineHeight: 1.4,
            resize: "vertical",
          }}
          disabled={isBusy}
        />
        <div
          className="af2-muted-2"
          style={{ marginTop: 4, fontSize: 11, textAlign: "right" }}
        >
          {charactersLeft} of {STATEMENT_MAX} characters left
        </div>

        {/* Optional structured prompts. Compact two-column layout so the
            card matches the v2 reference's airy single-card feel. */}
        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          {STRUCTURED_FIELDS.map((field) => (
            <div key={field.key}>
              <label htmlFor={`metadata-${field.key}`} className="af2-eyebrow">
                {field.label}
              </label>
              <input
                id={`metadata-${field.key}`}
                type="text"
                className="af2-input"
                value={metadata[field.key] ?? ""}
                onChange={(e) => updateMetadata(field.key, e.target.value)}
                placeholder={field.placeholder}
                style={{ width: "100%", marginTop: 6 }}
                disabled={isBusy}
              />
            </div>
          ))}
        </div>

        {/* Readiness pill + actions row, mirroring the v2 footer pattern. */}
        <div className="af2-row" style={{ marginTop: 16, gap: 10 }}>
          <span className="af2-pill" aria-label={`Readiness ${readiness.toFixed(2)}`}>
            <span
              className="af2-dot"
              style={{ background: readiness >= 0.5 ? "var(--af2-sage)" : "var(--af2-ink-3)" }}
            />
            Readiness {readiness.toFixed(2)} · {readinessLabel(readiness)}
          </span>
          <span className="af2-spacer" />
          <button
            type="button"
            onClick={() => void handleSave(false)}
            disabled={!canSave}
            className="af2-btn"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: canSave ? 1 : 0.5,
              cursor: canSave ? "pointer" : "not-allowed",
            }}
          >
            {submitState === "saving" ? <Loader2 size={14} className="animate-spin" /> : null}
            Save draft
          </button>
          <button
            type="button"
            onClick={() => void handleSave(true)}
            disabled={!canGenerate}
            className="af2-btn af2-btn-clay"
            title={
              !hasLLM && !llmCheckLoading
                ? "Add an LLM model in Settings → Models first"
                : undefined
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: canGenerate ? 1 : 0.5,
              cursor: canGenerate ? "pointer" : "not-allowed",
            }}
          >
            {submitState === "generating" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {submitState === "generating" ? "Generating…" : "Generate hiring plan →"}
          </button>
        </div>
      </div>

      {/* Past missions — compact editorial list of prior briefs. */}
      <h3 className="af2-h3 font-af2-serif" style={{ marginTop: 28, marginBottom: 12 }}>
        Past missions
      </h3>

      {loadingList && missions.length === 0 ? (
        <LoadingState label="Loading missions…" />
      ) : null}

      {listError ? (
        <ErrorState
          title="Couldn't load missions"
          message={listError}
          onRetry={() => void refreshMissions()}
        />
      ) : null}

      {deleteError ? (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            borderRadius: "var(--af2-radius)",
            border: "1px solid rgba(192,84,76,0.30)",
            background: "rgba(192,84,76,0.10)",
            color: "var(--af2-clay)",
            fontSize: 13,
          }}
        >
          {deleteError}
        </div>
      ) : null}

      {!listError && !loadingList && missions.length === 0 ? (
        <div
          className="af2-card"
          style={{
            padding: "32px 24px",
            textAlign: "center",
            borderStyle: "dashed",
            borderColor: "var(--af2-line-2)",
          }}
        >
          <p
            className="font-af2-serif"
            style={{ fontSize: 15, color: "var(--af2-ink-2)", margin: 0 }}
          >
            No missions yet. Draft your first one above to get started.
          </p>
        </div>
      ) : null}

      {missions.length > 0 ? (
        <div className="af2-list">
          {missions.map((mission, index) => (
            <div
              key={mission.id}
              className="af2-list-row"
              style={{
                gridTemplateColumns: "1fr 120px 110px 36px",
                cursor: "default",
                borderBottom:
                  index < missions.length - 1 ? "1px solid var(--af2-line)" : "none",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <p
                  className="font-af2-serif"
                  style={{
                    fontSize: 14,
                    lineHeight: 1.4,
                    color: "var(--af2-ink)",
                    margin: 0,
                  }}
                >
                  {mission.statement}
                </p>
                <div
                  className="af2-mono af2-muted-2"
                  style={{
                    marginTop: 4,
                    fontSize: 11,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <span>{mission.companyName}</span>
                  <span>·</span>
                  <span>{formatRelative(mission.createdAt)}</span>
                  {mission.latestHiringPlanId ? (
                    <>
                      <span>·</span>
                      <span style={{ color: "var(--af2-sage)" }}>plan drafted</span>
                    </>
                  ) : null}
                </div>
              </div>
              <span className="af2-muted" style={{ fontSize: 11.5 }}>
                {mission.status}
              </span>
              <div style={{ textAlign: "right" }}>
                {mission.latestHiringPlanId ? (
                  mission.status === "active" ? (
                    <Link
                      to="/team"
                      className="af2-btn af2-btn-sm"
                      style={{ textDecoration: "none", display: "inline-block" }}
                    >
                      View team
                    </Link>
                  ) : (
                    <Link
                      to={`/hire/plan/${mission.id}/${mission.latestHiringPlanId}`}
                      className="af2-btn af2-btn-sm af2-btn-clay"
                      style={{
                        textDecoration: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      Review plan
                    </Link>
                  )
                ) : null}
              </div>
              <button
                type="button"
                aria-label={`Discard mission: ${mission.statement.slice(0, 60)}`}
                title="Discard mission"
                disabled={deletingId === mission.id}
                onClick={() => void handleDelete(mission)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: deletingId === mission.id ? "wait" : "pointer",
                  color: "var(--af2-muted)",
                  padding: 6,
                  borderRadius: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: deletingId === mission.id ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (deletingId !== mission.id) {
                    e.currentTarget.style.color = "var(--af2-clay)";
                    e.currentTarget.style.background = "rgba(192,84,76,0.08)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--af2-muted)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {deletingId === mission.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </div>
          ))}
        </div>
      ) : null}
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
