/**
 * Hiring Plan Review page (HEL-105, ported from the closed PR #747 on top
 * of the HEL-25 backend that landed in PR #745).
 *
 * Side-by-side view: mission statement + company context on the left,
 * generated plan summary + rationale + 30/60/90 roadmap on the right.
 * Below: agent cards for each role the plan provisions. Confirm CTA
 * calls `POST /api/hiring-plans/:hiringPlanId/confirm` (the endpoint
 * shipped in #745) and re-fetches the plan so the confirmed state is
 * reflected.
 *
 * Mirrors the v2 design spec — "User reviews and edits the generated
 * plan in the UI (side-by-side mission ↔ plan)" — which the inline
 * Confirm button on the Hire page didn't fully capture.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Loader2, Users } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  getHiringPlan,
  confirmHiringPlan,
  type HiringPlanResponse,
  type StaffingRecommendation,
} from "../api/missionsApi";

type PageState = "loading" | "ready" | "confirming" | "confirmed" | "error";

function ModelTierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    lite: "bg-af2-paper-2 text-af2-ink-3",
    standard: "af2-tone-bg-sage",
    power: "af2-tone-bg-clay",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[tier] ?? "bg-af2-paper-2 text-af2-ink-3"}`}
    >
      {tier}
    </span>
  );
}

function AgentCard({ agent }: { agent: StaffingRecommendation }) {
  return (
    <div className="af2-card" style={{ padding: 16 }}>
      <div className="af2-row" style={{ alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="af2-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="af2-serif" style={{ fontSize: 14, fontWeight: 600 }}>
              {agent.title}
            </span>
            <ModelTierBadge tier={agent.modelTier} />
            {agent.budgetMonthlyUsd != null ? (
              <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
                ${agent.budgetMonthlyUsd.toLocaleString()}/mo
              </span>
            ) : null}
          </div>
          <p className="af2-muted" style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5 }}>
            {agent.mandate}
          </p>
        </div>
      </div>
      {agent.kpis.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <div className="af2-eyebrow" style={{ marginBottom: 4 }}>
            KPIs
          </div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {agent.kpis.map((kpi) => (
              <li key={kpi} className="af2-muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                {kpi}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function HiringPlanReview() {
  // Route shape: /hire/plan/:missionId/:planId. The missionId is kept in the
  // URL for breadcrumb context + back-links, but the API calls below key
  // off planId only — that's the canonical lookup id post-HEL-25.
  const { planId } = useParams<{ missionId: string; planId: string }>();
  const { requireAccessToken } = useAuth();
  const navigate = useNavigate();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [plan, setPlan] = useState<HiringPlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!planId) return;
    setPageState("loading");
    setError(null);
    try {
      const token = await requireAccessToken();
      const data = await getHiringPlan(planId, token);
      setPlan(data);
      setPageState(data.acceptedAt ? "confirmed" : "ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load hiring plan");
      setPageState("error");
    }
  }, [planId, requireAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleConfirm() {
    if (!planId) return;
    setPageState("confirming");
    setError(null);
    try {
      const token = await requireAccessToken();
      await confirmHiringPlan(planId, token);
      setPageState("confirmed");
      // Refresh plan data so the confirmed state is reflected.
      const refreshed = await getHiringPlan(planId, token);
      setPlan(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm plan");
      setPageState("ready");
    }
  }

  const agents = plan?.plan.provisioningPlan.agents ?? [];
  const executives = plan?.plan.orgChart.executives ?? [];
  const operators = plan?.plan.orgChart.operators ?? [];

  return (
    <div className="af2-page text-af2-ink" style={{ maxWidth: 1200 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce · Hiring · Plan Review</div>
          <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Review hiring plan
          </h1>
          <div className="af2-page-head-meta">
            {plan?.plan.summary ?? "Review the generated org plan and confirm to provision agents."}
          </div>
        </div>
        <div className="af2-page-actions">
          <Link
            to="/hire"
            className="af2-btn af2-btn-ghost af2-btn-sm"
            style={{ textDecoration: "none" }}
          >
            ← Back to Hire
          </Link>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: 16,
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

      {pageState === "loading" ? (
        <div className="af2-card" style={{ padding: 40, textAlign: "center" }}>
          <Loader2 className="animate-spin" style={{ margin: "0 auto 12px", opacity: 0.5 }} />
          <p className="af2-muted">Loading hiring plan…</p>
        </div>
      ) : pageState === "error" && !plan ? (
        <div className="af2-card" style={{ padding: 40, textAlign: "center" }}>
          <p className="af2-muted">Plan could not be loaded. Check the URL and try again.</p>
        </div>
      ) : plan ? (
        <>
          {/* Side-by-side: mission ↔ plan summary */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
              gap: 20,
              marginBottom: 24,
            }}
          >
            {/* Left: mission */}
            <div className="af2-card" style={{ padding: 22 }}>
              <div className="af2-eyebrow" style={{ marginBottom: 10 }}>
                Mission
              </div>
              <p className="af2-serif" style={{ fontSize: 15, lineHeight: 1.6 }}>
                {plan.missionStatement}
              </p>
              {plan.plan.company.targetCustomer ? (
                <div style={{ marginTop: 14 }}>
                  <div className="af2-eyebrow">Target customer</div>
                  <p className="af2-muted" style={{ marginTop: 4, fontSize: 13 }}>
                    {plan.plan.company.targetCustomer}
                  </p>
                </div>
              ) : null}
              {plan.plan.company.budget ? (
                <div style={{ marginTop: 10 }}>
                  <div className="af2-eyebrow">Budget</div>
                  <p className="af2-muted" style={{ marginTop: 4, fontSize: 13 }}>
                    {plan.plan.company.budget}
                  </p>
                </div>
              ) : null}
              {plan.plan.company.timeHorizon ? (
                <div style={{ marginTop: 10 }}>
                  <div className="af2-eyebrow">Time horizon</div>
                  <p className="af2-muted" style={{ marginTop: 4, fontSize: 13 }}>
                    {plan.plan.company.timeHorizon}
                  </p>
                </div>
              ) : null}
            </div>

            {/* Right: plan summary + rationale */}
            <div className="af2-card" style={{ padding: 22 }}>
              <div className="af2-eyebrow" style={{ marginBottom: 10 }}>
                Plan — {plan.plan.provisioningPlan.teamName}
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--af2-ink-2)" }}>
                {plan.plan.rationale}
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 12,
                  marginTop: 18,
                }}
              >
                {(
                  [
                    { label: "Day 30", data: plan.plan.roadmap306090.day30 },
                    { label: "Day 60", data: plan.plan.roadmap306090.day60 },
                    { label: "Day 90", data: plan.plan.roadmap306090.day90 },
                  ] as const
                ).map(({ label, data }) => (
                  <div key={label} className="af2-card" style={{ background: "var(--af2-paper-2)" }}>
                    <div className="af2-eyebrow">{label}</div>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 14 }}>
                      {data.objectives.map((obj) => (
                        <li key={obj} className="af2-muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                          {obj}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Agents to provision */}
          <div style={{ marginBottom: 24 }}>
            <div className="af2-row" style={{ marginBottom: 14, alignItems: "center" }}>
              <div>
                <div className="af2-eyebrow">Agents to provision</div>
                <div className="af2-row" style={{ gap: 8, marginTop: 4 }}>
                  <span className="af2-mono af2-muted-2" style={{ fontSize: 12 }}>
                    <Users size={12} style={{ display: "inline", marginRight: 4 }} />
                    {executives.length} executive{executives.length !== 1 ? "s" : ""} ·{" "}
                    {operators.length} operator{operators.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </div>

            {agents.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 12,
                }}
              >
                {agents.map((agent) => (
                  <AgentCard key={agent.roleKey} agent={agent} />
                ))}
              </div>
            ) : (
              <p className="af2-muted">No agents in this plan.</p>
            )}
          </div>

          {/* Confirm / confirmed state */}
          {pageState === "confirmed" || plan.acceptedAt ? (
            <div
              className="af2-card"
              style={{
                padding: "18px 22px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                borderColor: "rgba(74,107,74,0.4)",
                background: "rgba(74,107,74,0.06)",
              }}
            >
              <CheckCircle2 size={20} style={{ color: "var(--af2-sage)", flexShrink: 0 }} />
              <div>
                <p style={{ fontWeight: 600, fontSize: 14 }}>Plan confirmed</p>
                <p className="af2-muted" style={{ marginTop: 2, fontSize: 13 }}>
                  {agents.length} agent{agents.length !== 1 ? "s" : ""} provisioned. The org chart
                  on the{" "}
                  <Link to="/workspace/org-structure" style={{ color: "var(--af2-sage)" }}>
                    Team page
                  </Link>{" "}
                  will reflect the new graph.
                </p>
              </div>
            </div>
          ) : (
            <div className="af2-card" style={{ padding: "18px 22px" }}>
              <p style={{ fontSize: 14, color: "var(--af2-ink-2)", marginBottom: 14 }}>
                Confirming will provision {agents.length} agent
                {agents.length !== 1 ? "s" : ""} and wire up the reporting structure. This cannot
                be undone from this screen.
              </p>
              <div className="af2-row" style={{ gap: 10 }}>
                <span className="af2-spacer" />
                <button
                  type="button"
                  onClick={() => void navigate("/hire")}
                  className="af2-btn af2-btn-ghost"
                  disabled={pageState === "confirming"}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={pageState === "confirming"}
                  className="af2-btn af2-btn-clay"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    opacity: pageState === "confirming" ? 0.7 : 1,
                    cursor: pageState === "confirming" ? "not-allowed" : "pointer",
                  }}
                >
                  {pageState === "confirming" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : null}
                  {pageState === "confirming" ? "Provisioning…" : "Confirm & provision agents →"}
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
