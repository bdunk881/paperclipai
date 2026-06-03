/**
 * Hire page (HEL-23, v2 prototype port).
 *
 * v2 prototype port: docs/design/v2/preview/consolidation.html lines 787-853.
 *
 * Data flow is unchanged from the HEL-23 / HEL-24 / HEL-105 surface area:
 *   - `createMission` persists the draft via POST /api/missions
 *   - `generateHiringPlan` calls HEL-24's POST /api/missions/:id/generate-plan
 *   - On a successful generate, we navigate to /hire/plan/:missionId/:planId
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/ToastProvider";
import {
  createMission,
  deleteMission,
  generateHiringPlan,
  listMissions,
  type Mission,
  type MissionCustomContextEntry,
  type MissionMetadata,
} from "../api/missionsApi";
import { listLLMConfigs, type LLMConfig } from "../api/client";
import { getHostedFreeCatalog } from "../api/hostedFreeModelsApi";
import { ConfirmDestructiveModal } from "../components/missions/ConfirmDestructiveModal";
import { formatUserFacingError } from "../lib/userFacingError";
import { teamLinkForMission } from "../lib/missionNavigation";

type SubmitState = "idle" | "saving" | "generating" | "error";

// HEL-211: canonical pill keys are the four structured prompts the LLM
// treats specially. Owner-defined free-form pills live on
// `MissionMetadata.customContext` and are handled separately.
type ContextPillKey = "industry" | "targetCustomer" | "successMetric" | "runway";

const CONTEXT_PILLS: Array<{
  key: ContextPillKey;
  label: string;
  placeholder: string;
}> = [
  { key: "industry", label: "industry", placeholder: "design agencies" },
  {
    key: "targetCustomer",
    label: "target customer",
    placeholder: "10–50 employees",
  },
  { key: "successMetric", label: "success metric", placeholder: "5 booked demos" },
  { key: "runway", label: "runway", placeholder: "$250 / week" },
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

function buildMetadataForSubmit(
  metadata: MissionMetadata,
  enabledPills: Set<ContextPillKey>,
  customContext: MissionCustomContextEntry[],
): MissionMetadata {
  const out: MissionMetadata = {};
  for (const { key } of CONTEXT_PILLS) {
    if (!enabledPills.has(key)) continue;
    const value = metadata[key]?.trim();
    if (value) out[key] = value;
  }
  const trimmedCustom = customContext
    .map((entry) => ({ label: entry.label.trim(), value: entry.value.trim() }))
    .filter((entry) => entry.label.length > 0 && entry.value.length > 0);
  if (trimmedCustom.length > 0) {
    out.customContext = trimmedCustom;
  }
  return out;
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
  // Phase 2b Phase 1: client-side progress signal during plan generation.
  // The backend's /api/missions/:id/generate-plan is a sync POST that can
  // take up to 90s on a power-tier LLM. Without feedback the user sees a
  // spinning button and assumes the app froze. We tick a counter every
  // 250ms while submitState === "generating" and surface reassurance
  // messages at 15s / 30s / 60s thresholds so it's obvious something's
  // still happening. Phase 2 (separate PR) switches the route to SSE so
  // we can show actual token streaming.
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  useEffect(() => {
    if (generationStartedAt === null) {
      setGenerationElapsedMs(0);
      return;
    }
    const tick = () => setGenerationElapsedMs(Date.now() - generationStartedAt);
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [generationStartedAt]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<Mission | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[] | null>(null);
  const [llmConfigError, setLlmConfigError] = useState<string | null>(null);
  const [hostedFreeCatalog, setHostedFreeCatalog] = useState<
    Awaited<ReturnType<typeof getHostedFreeCatalog>> | null
  >(null);
  const [enabledPills, setEnabledPills] = useState<Set<ContextPillKey>>(
    () => new Set(),
  );
  const [selectedLlmConfigId, setSelectedLlmConfigId] = useState<string | null>(null);
  const [regeneratingMissionId, setRegeneratingMissionId] = useState<string | null>(null);
  // HEL-211: owner-defined free-form context pills + the modal composer.
  const [customContext, setCustomContext] = useState<MissionCustomContextEntry[]>([]);
  const [addDetailOpen, setAddDetailOpen] = useState(false);
  const [pendingLabel, setPendingLabel] = useState("");
  const [pendingValue, setPendingValue] = useState("");

  const modelOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string; detail: string }> = [];
    for (const cfg of llmConfigs ?? []) {
      opts.push({
        id: cfg.id,
        label: cfg.label,
        detail: `${cfg.provider} · ${cfg.model}${cfg.isDefault ? " · default" : ""}`,
      });
    }
    if (opts.length === 0 && hostedFreeCatalog) {
      for (const provider of hostedFreeCatalog.providers) {
        if (!provider.available) continue;
        opts.push({
          id: `hosted-free:${provider.id}`,
          label: provider.label,
          detail: `${provider.provider} · ${provider.modelId} · AutoFlow hosted`,
        });
      }
    }
    return opts;
  }, [llmConfigs, hostedFreeCatalog]);

  const hasLLM = modelOptions.length > 0;
  const canUseLlm = hasLLM;
  const llmCheckLoading = llmConfigs === null && llmConfigError === null;

  useEffect(() => {
    if (modelOptions.length === 0) {
      setSelectedLlmConfigId(null);
      return;
    }
    setSelectedLlmConfigId((prev) => {
      if (prev && modelOptions.some((o) => o.id === prev)) return prev;
      const defaultCfg = llmConfigs?.find((c) => c.isDefault);
      return defaultCfg?.id ?? modelOptions[0]?.id ?? null;
    });
  }, [modelOptions, llmConfigs]);

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

  async function handleDelete(mission: Mission): Promise<void> {
    setDiscarding(true);
    setDeletingId(mission.id);
    setDeleteError(null);
    try {
      const token = await requireAccessToken();
      await deleteMission(mission.id, token);
      setMissions((current) => current.filter((m) => m.id !== mission.id));
      void refreshMissions();
      toast.success("Mission discarded.");
      setDiscardTarget(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete mission";
      setDeleteError(msg);
      toast.error(msg);
    } finally {
      setDeletingId(null);
      setDiscarding(false);
    }
  }

  useEffect(() => {
    void refreshMissions();
  }, [refreshMissions]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await requireAccessToken();
        const [list, hosted] = await Promise.all([
          listLLMConfigs(token),
          getHostedFreeCatalog(token).catch(() => null),
        ]);
        if (!cancelled) {
          setLlmConfigs(list);
          setHostedFreeCatalog(hosted);
        }
      } catch (err) {
        if (!cancelled) {
          setLlmConfigError(err instanceof Error ? err.message : "Failed to check LLM models");
          setLlmConfigs([]);
          setHostedFreeCatalog(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requireAccessToken]);

  const trimmedStatement = statement.trim();
  const isBusy = submitState === "saving" || submitState === "generating";
  const canGenerate =
    trimmedStatement.length > 0 &&
    !isBusy &&
    canUseLlm &&
    !llmCheckLoading &&
    Boolean(selectedLlmConfigId);

  function removeCanonicalPill(key: ContextPillKey) {
    setEnabledPills((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  function updateMetadata<K extends ContextPillKey>(key: K, value: string) {
    setMetadata((current) => ({ ...current, [key]: value }));
  }

  function commitPendingCustomEntry() {
    const label = pendingLabel.trim();
    const value = pendingValue.trim();
    if (!label || !value) return;
    setCustomContext((cur) => [...cur, { label, value }]);
    setPendingLabel("");
    setPendingValue("");
    setAddDetailOpen(false);
  }

  function cancelPendingCustomEntry() {
    setAddDetailOpen(false);
    setPendingLabel("");
    setPendingValue("");
  }

  async function handleRegenerateMission(mission: Mission): Promise<void> {
    if (!selectedLlmConfigId) {
      toast.error("Select a connected model before regenerating.");
      return;
    }
    setRegeneratingMissionId(mission.id);
    try {
      const token = await requireAccessToken();
      const plan = await generateHiringPlan(mission.id, token, {
        llmConfigId: selectedLlmConfigId,
      });
      navigate(`/hire/plan/${mission.id}/${plan.hiringPlanId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to regenerate plan");
    } finally {
      setRegeneratingMissionId(null);
    }
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
        {
          statement: trimmedStatement,
          metadata: buildMetadataForSubmit(metadata, enabledPills, customContext),
        },
        token,
      );
      setMissions((current) => [created, ...current]);

      if (generateAfter) {
        setGenerationStartedAt(Date.now());
        try {
          const plan = await generateHiringPlan(created.id, token, {
            llmConfigId: selectedLlmConfigId ?? undefined,
          });
          setSubmitState("idle");
          setGenerationStartedAt(null);
          navigate(`/hire/plan/${created.id}/${plan.hiringPlanId}`);
          return;
        } catch (planErr) {
          const planMsg = planErr instanceof Error ? planErr.message : String(planErr);
          setNotice(
            `Mission saved as a draft, but plan generation failed: ${planMsg}. You can retry from past missions below.`,
          );
          toast.error(`Plan generation failed for ${created.statement.slice(0, 60)}…`);
        } finally {
          setGenerationStartedAt(null);
        }
      } else {
        toast.success("Mission saved as a draft.");
      }

      setStatement("");
      setMetadata({});
      setEnabledPills(new Set());
      setCustomContext([]);
      void refreshMissions();
      setSubmitState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save mission");
      setSubmitState("error");
    }
  }

  const sectionLabelStyle: React.CSSProperties = {
    margin: "10px 0 6px",
    fontSize: 11,
    color: "var(--af2-ink-3)",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
  };

  return (
    <div className="af2-v2">
      <div className="af2-page">
        <div className="page-head">
          <div className="page-head-left">
            <h1 className="h1">Hire</h1>
            <div className="meta">
              Describe a mission · we&rsquo;ll draft a hiring plan
            </div>
          </div>
        </div>

        {notice ? (
          <div
            style={{
              marginBottom: 14,
              padding: "10px 14px",
              borderRadius: 6,
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
              borderRadius: 6,
              border: "1px solid rgba(194,80,43,0.3)",
              background: "rgba(194,80,43,0.10)",
              color: "var(--af2-clay)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        {!llmCheckLoading && !canUseLlm ? (
          <div
            className="card"
            style={{
              borderColor: "var(--af2-mustard)",
              background:
                "color-mix(in srgb, var(--af2-mustard) 10%, var(--af2-card))",
            }}
          >
            <h3>Connect a model before you can generate a hiring plan</h3>
            <p className="desc">
              AutoFlow uses your own API key to draft the org chart, budget, and
              first week of work. Add an OpenAI, Anthropic, or other provider key
              in Models, then come back here.
            </p>
            {llmConfigError ? (
              <p
                className="desc"
                style={{ color: "var(--af2-clay)", marginTop: 6 }}
              >
                {llmConfigError}
              </p>
            ) : null}
            <Link
              to="/settings/llm-providers"
              className="btn primary"
              style={{ marginTop: 10 }}
            >
              Add a model →
            </Link>
          </div>
        ) : null}

        {/* Mission card */}
        <div className="card">
          <h3>What should your new team do?</h3>
          <label className="field">
            Mission statement
            <textarea
              rows={4}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="e.g. Book 5 qualified product demos this week from inbound and warm outbound."
              disabled={isBusy}
            />
          </label>

          <div style={sectionLabelStyle}>Context for the team</div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 14,
            }}
          >
            {CONTEXT_PILLS.filter((pill) => enabledPills.has(pill.key)).map(
              (pill) => (
                <span key={pill.key} className="pill removable">
                  {pill.label}:{" "}
                  <input
                    type="text"
                    value={metadata[pill.key] ?? ""}
                    onChange={(e) => updateMetadata(pill.key, e.target.value)}
                    placeholder={pill.placeholder}
                    disabled={isBusy}
                    aria-label={pill.label}
                    style={{
                      border: 0,
                      background: "transparent",
                      padding: 0,
                      margin: 0,
                      font: "inherit",
                      fontWeight: 600,
                      color: "var(--af2-ink)",
                      width: `${Math.max(8, (metadata[pill.key] ?? pill.placeholder).length)}ch`,
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    className="x"
                    aria-label={`Remove ${pill.label}`}
                    onClick={() => removeCanonicalPill(pill.key)}
                    disabled={isBusy}
                  >
                    ×
                  </button>
                </span>
              ),
            )}
            {/* Re-add buttons for any canonical pills the user removed */}
            {CONTEXT_PILLS.filter((pill) => !enabledPills.has(pill.key)).map(
              (pill) => (
                <button
                  key={pill.key}
                  type="button"
                  className="btn sm"
                  onClick={() =>
                    setEnabledPills((cur) => {
                      const next = new Set(cur);
                      next.add(pill.key);
                      return next;
                    })
                  }
                  disabled={isBusy}
                >
                  + {pill.label}
                </button>
              ),
            )}
          </div>

          <div style={sectionLabelStyle}>
            Add anything else the team should know
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 10,
              alignItems: "center",
            }}
          >
            {customContext.map((entry, index) => (
              <span key={`${entry.label}-${index}`} className="pill removable">
                {entry.label}: <b>{entry.value}</b>
                <button
                  type="button"
                  className="x"
                  aria-label={`Remove ${entry.label}`}
                  onClick={() =>
                    setCustomContext((cur) => cur.filter((_, i) => i !== index))
                  }
                  disabled={isBusy}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="btn sm"
              onClick={() => setAddDetailOpen(true)}
              disabled={isBusy}
            >
              + Add detail
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <select
              value={selectedLlmConfigId ?? ""}
              onChange={(e) => setSelectedLlmConfigId(e.target.value || null)}
              disabled={isBusy || modelOptions.length === 0}
              style={{
                flex: 1,
                background: "var(--af2-card)",
                border: "1px solid var(--af2-line-2)",
                borderRadius: 6,
                padding: "5px 10px",
                fontSize: 12,
                color: "var(--af2-ink-2)",
              }}
            >
              {modelOptions.length === 0 ? (
                <option value="">No model connected</option>
              ) : (
                modelOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label} — {opt.detail}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleSave(true)}
              disabled={!canGenerate}
              title={
                !canUseLlm && !llmCheckLoading
                  ? "Add an LLM model in Settings → Models first"
                  : undefined
              }
            >
              {submitState === "generating"
                ? `Generating… ${Math.floor(generationElapsedMs / 1000)}s`
                : "Draft hiring plan →"}
            </button>
          </div>

          {submitState === "generating" ? (
            <div
              style={{
                marginTop: 12,
                padding: "10px 14px",
                background: "var(--af2-paper-2)",
                border: "1px solid var(--af2-line)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--af2-ink-2)",
                lineHeight: 1.5,
              }}
              role="status"
              aria-live="polite"
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--af2-clay)",
                    animation: "af2-pulse 1.2s ease-in-out infinite",
                  }}
                />
                <b>
                  Drafting your hiring plan ·{" "}
                  {Math.floor(generationElapsedMs / 1000)}s elapsed
                </b>
              </div>
              <div style={{ marginTop: 6, color: "var(--af2-ink-3)" }}>
                {generationElapsedMs < 15_000 ? (
                  <>
                    The LLM is reading your mission and drafting the org chart.
                    Most plans return in 10–30s.
                  </>
                ) : generationElapsedMs < 30_000 ? (
                  <>
                    Still working — power-tier reasoning models can take
                    20–60s for missions with rich context.
                  </>
                ) : generationElapsedMs < 60_000 ? (
                  <>
                    Taking a little longer than usual. The request will time
                    out at 90s if the model doesn't respond by then.
                  </>
                ) : (
                  <>
                    Almost at the 90s cutoff. If this times out, your
                    mission is saved as a draft and you can retry from the
                    list below.
                  </>
                )}
              </div>
            </div>
          ) : null}

          <div className="pro-only pro-block">
            <div className="label">Pro · Live prompt preview</div>
            <pre>{buildPromptPreview(statement, metadata, enabledPills, customContext)}</pre>
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn sm">
                Copy to clipboard
              </button>{" "}
              <button type="button" className="btn sm">
                Save as template
              </button>
            </div>
          </div>
        </div>

        {/* Past missions / agent rename — second card */}
        <div className="card">
          <h3>Agent rename · after plan review</h3>
          <p className="desc">
            Sliding modal step after plan review · give each provisioned agent a
            real name above their title. Stored as{" "}
            <code>agents.display_name</code>.
          </p>
          {loadingList && missions.length === 0 ? (
            <p className="desc" style={{ marginTop: 10 }}>
              Loading past missions…
            </p>
          ) : null}
          {listError ? (
            <p
              className="desc"
              style={{ color: "var(--af2-clay)", marginTop: 10 }}
            >
              {listError}
            </p>
          ) : null}
          {deleteError ? (
            <p
              className="desc"
              style={{ color: "var(--af2-clay)", marginTop: 10 }}
            >
              {deleteError}
            </p>
          ) : null}
          {!listError && !loadingList && missions.length === 0 ? (
            <p className="desc" style={{ marginTop: 10 }}>
              No missions yet — draft your first one above.
            </p>
          ) : null}
          {missions.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              {missions.map((mission) => (
                <div
                  key={mission.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "60px 1fr auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "10px 0",
                    borderTop: "1px solid var(--af2-line)",
                  }}
                >
                  <div
                    className="avatar"
                    style={{ width: 32, height: 32, fontSize: 12 }}
                  >
                    {mission.statement.slice(0, 1).toUpperCase() || "M"}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        lineHeight: 1.4,
                        color: "var(--af2-ink)",
                      }}
                    >
                      {mission.statement.length > 100
                        ? `${mission.statement.slice(0, 100)}…`
                        : mission.statement}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--af2-ink-3)",
                        marginTop: 4,
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span>{mission.companyName}</span>
                      <span>·</span>
                      <span>{formatRelative(mission.createdAt)}</span>
                      <span>·</span>
                      <span
                        className={
                          mission.status === "active"
                            ? "pill sage dot"
                            : "pill"
                        }
                      >
                        {mission.status}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {mission.latestHiringPlanId ? (
                      mission.status === "active" ? (
                        <Link
                          to={teamLinkForMission(mission.id)}
                          className="btn sm"
                        >
                          View team
                        </Link>
                      ) : (
                        <>
                          <Link
                            to={`/hire/plan/${mission.id}/${mission.latestHiringPlanId}`}
                            className="btn sm primary"
                          >
                            Review
                          </Link>
                          <button
                            type="button"
                            className="btn sm"
                            disabled={
                              regeneratingMissionId === mission.id ||
                              !selectedLlmConfigId ||
                              isBusy
                            }
                            onClick={() =>
                              void handleRegenerateMission(mission)
                            }
                          >
                            {regeneratingMissionId === mission.id
                              ? "…"
                              : "Regenerate"}
                          </button>
                        </>
                      )
                    ) : null}
                    <button
                      type="button"
                      className="btn sm danger"
                      aria-label={`Discard mission: ${mission.statement.slice(0, 60)}`}
                      disabled={deletingId === mission.id}
                      onClick={() => setDiscardTarget(mission)}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <ConfirmDestructiveModal
          open={discardTarget !== null}
          onClose={() => setDiscardTarget(null)}
          eyebrow="Discard mission"
          title="Discard this mission?"
          message={
            discardTarget
              ? `"${discardTarget.statement.slice(0, 140)}${
                  discardTarget.statement.length > 140 ? "…" : ""
                }"\n\nAny draft hiring plan attached to it will also be deleted. This can't be undone.`
              : ""
          }
          confirmLabel="Discard mission"
          confirming={discarding}
          onConfirm={async () => {
            if (discardTarget) await handleDelete(discardTarget);
          }}
        />

        {addDetailOpen ? (
          <div
            className="af2-v2-modal-overlay"
            onClick={cancelPendingCustomEntry}
          >
            <div
              className="af2-v2-modal"
              role="dialog"
              aria-label="Add custom context pill"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="af2-v2-modal-head">
                <div>
                  <div className="eyebrow" style={{ marginBottom: 4 }}>
                    Hiring · Custom pill
                  </div>
                  <h2>Add a detail</h2>
                </div>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={cancelPendingCustomEntry}
                >
                  Esc · Close
                </button>
              </div>
              <div className="af2-v2-modal-body">
                <label className="field">
                  Label
                  <input
                    type="text"
                    value={pendingLabel}
                    onChange={(e) => setPendingLabel(e.target.value)}
                    placeholder="compliance"
                    maxLength={64}
                    autoFocus
                  />
                </label>
                <label className="field">
                  Value
                  <input
                    type="text"
                    value={pendingValue}
                    onChange={(e) => setPendingValue(e.target.value)}
                    placeholder="HIPAA + SOC 2 required"
                    maxLength={280}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitPendingCustomEntry();
                      } else if (e.key === "Escape") {
                        cancelPendingCustomEntry();
                      }
                    }}
                  />
                </label>
              </div>
              <div className="af2-v2-modal-foot">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={cancelPendingCustomEntry}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={
                    pendingLabel.trim().length === 0 ||
                    pendingValue.trim().length === 0
                  }
                  onClick={commitPendingCustomEntry}
                >
                  Add detail
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function buildPromptPreview(
  statement: string,
  metadata: MissionMetadata,
  enabledPills: Set<ContextPillKey>,
  customContext: MissionCustomContextEntry[],
): string {
  const lines: string[] = [
    "You are the AutoFlow team designer.",
    `GOAL: ${statement || "(no mission statement yet)"}`,
    "CONTEXT:",
  ];
  for (const { key, label } of CONTEXT_PILLS) {
    if (!enabledPills.has(key)) continue;
    const value = metadata[key];
    if (value) lines.push(`  ${label.replace(/\s+/g, "_")}: ${value}`);
  }
  for (const entry of customContext) {
    if (entry.label && entry.value) {
      lines.push(`  ${entry.label}: ${entry.value}`);
    }
  }
  return lines.join("\n");
}
