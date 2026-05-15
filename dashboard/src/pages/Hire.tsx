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
    <div className="af2-page text-af2-ink" style={{ maxWidth: 920 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce · Hiring</div>
          <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Hire from a mission.
          </h1>
          <div className="af2-page-head-meta">
            Tell AutoFlow what you need done. We&rsquo;ll draft an org, a budget, and the first
            week of work.
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

      {/* Mission statement card */}
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
          rows={4}
          style={{
            width: "100%",
            marginTop: 8,
            fontSize: 16,
            fontFamily: "var(--af2-serif)",
            lineHeight: 1.4,
            resize: "vertical",
          }}
          disabled={submitState === "saving" || submitState === "generating"}
        />
        <div
          className="af2-muted-2"
          style={{ marginTop: 4, fontSize: 11, textAlign: "right" }}
        >
          {charactersLeft} of {STATEMENT_MAX} characters left
        </div>

        {/* Structured prompts */}
        <div
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 14,
          }}
        >
          {STRUCTURED_FIELDS.map((field) => (
            <div key={field.key}>
              <label htmlFor={`metadata-${field.key}`} className="af2-eyebrow">
                {field.label}
                <span
                  className="af2-muted-2"
                  style={{
                    marginLeft: 6,
                    fontWeight: 400,
                    textTransform: "none",
                    letterSpacing: 0,
                    fontSize: 11,
                  }}
                >
                  optional
                </span>
              </label>
              <input
                id={`metadata-${field.key}`}
                type="text"
                className="af2-input"
                value={metadata[field.key] ?? ""}
                onChange={(e) => updateMetadata(field.key, e.target.value)}
                placeholder={field.placeholder}
                style={{ width: "100%", marginTop: 6 }}
                disabled={submitState === "saving" || submitState === "generating"}
              />
              <p className="af2-muted" style={{ marginTop: 4, fontSize: 11, lineHeight: 1.4 }}>
                {field.helper}
              </p>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="af2-row" style={{ marginTop: 18, gap: 10 }}>
          <span className="af2-muted-2" style={{ fontSize: 11.5 }}>
            Saved missions stay in this workspace. Generate the plan when you&rsquo;re ready.
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
            {submitState === "generating" ? "Generating…" : "Save & generate plan →"}
          </button>
        </div>
      </div>

      {/* Inline LLM preview */}
      {trimmedStatement.length > 0 ? (
        <div
          className="af2-card"
          style={{
            marginTop: 18,
            padding: 18,
            background: "var(--af2-paper-2)",
            borderStyle: "dashed",
          }}
        >
          <div className="af2-eyebrow">How we&rsquo;ll brief the planner</div>
          <pre
            className="af2-mono"
            style={{
              marginTop: 8,
              whiteSpace: "pre-wrap",
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "var(--af2-ink-2)",
            }}
          >
            {preview}
          </pre>
        </div>
      ) : null}

      {/* Saved missions list */}
      <h3 className="af2-h3" style={{ marginTop: 28, marginBottom: 12 }}>
        Saved missions
      </h3>
      <div className="af2-row" style={{ marginBottom: 12 }}>
        <span className="af2-spacer" />
        <button
          type="button"
          onClick={() => void refreshMissions()}
          className="af2-btn af2-btn-sm af2-btn-ghost"
          disabled={loadingList}
        >
          {loadingList ? "Loading…" : "Refresh"}
        </button>
      </div>

      {listError ? (
        <div
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
          {listError}
        </div>
      ) : null}

      {!listError && missions.length === 0 && !loadingList ? (
        <div
          className="af2-card"
          style={{
            padding: "40px 24px",
            textAlign: "center",
            borderStyle: "dashed",
            borderColor: "var(--af2-line-2)",
          }}
        >
          <p className="af2-serif" style={{ fontSize: 15, color: "var(--af2-ink-2)" }}>
            No missions yet. Save your first one above to get started.
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
                gridTemplateColumns: "1fr 130px 90px",
                cursor: "default",
                borderBottom:
                  index < missions.length - 1 ? "1px solid var(--af2-line)" : "none",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <p
                  className="af2-serif"
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
                  <span>{mission.status}</span>
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
                  <Link
                    to="/team"
                    className="af2-btn af2-btn-sm"
                    style={{
                      textDecoration: "none",
                      display: "inline-block",
                    }}
                  >
                    View plan
                  </Link>
                ) : null}
              </div>
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
