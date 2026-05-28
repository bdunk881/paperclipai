import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCostThreshold,
  disableCostThreshold,
  fetchInfraCost,
  type BreachStatus,
  type CostBucket,
  type CostThreshold,
  type InfraCost,
} from "../api/costApi";
import { InfraTabs } from "../components/infra/InfraTabs";
import { MetricCard } from "../components/infra/MetricCard";
import { AskAgentButton } from "../components/agent/AskAgentButton";
import { ReasonPrompt } from "../components/ReasonPrompt";

const BUCKET_LABEL: Record<CostBucket, string> = {
  trailing_24h: "Trailing 24h",
  trailing_7d: "Trailing 7d",
  trailing_30d: "Trailing 30d",
  projected_daily: "Projected daily",
  projected_monthly: "Projected monthly",
  balance_runway_days: "Runway (days)",
};

const BUCKET_OPTIONS: CostBucket[] = [
  "projected_daily",
  "projected_monthly",
  "trailing_24h",
  "trailing_7d",
  "trailing_30d",
  "balance_runway_days",
];

function fmtUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return `$${value.toFixed(0)}`;
  if (Math.abs(value) >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function fmtObserved(b: BreachStatus): string {
  if (b.observed_value === null) return "n/a";
  return b.bucket === "balance_runway_days"
    ? `${b.observed_value.toFixed(1)} days`
    : fmtUsd(b.observed_value);
}

function fmtCeiling(b: BreachStatus): string {
  return b.bucket === "balance_runway_days"
    ? `${b.ceiling_value.toFixed(1)} days`
    : fmtUsd(b.ceiling_value);
}

function BreachBanner({ breaches }: { breaches: BreachStatus[] }) {
  const fired = breaches.filter((b) => b.breached);
  if (fired.length === 0) return null;
  return (
    <div className="banner danger" style={{ marginBottom: "1rem" }}>
      <strong>
        {fired.length} cost threshold{fired.length === 1 ? "" : "s"} breached
      </strong>
      <ul style={{ margin: "0.5rem 0 0 1rem", padding: 0 }}>
        {fired.map((b) => (
          <li key={b.threshold_id}>
            {BUCKET_LABEL[b.bucket]}: {fmtObserved(b)}{" "}
            {b.direction === "above_ceiling_breaches" ? "is above" : "is below"} ceiling{" "}
            {fmtCeiling(b)}
            {b.note ? ` — ${b.note}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ThresholdsCard({
  thresholds,
  breaches,
  onMutated,
}: {
  thresholds: CostThreshold[];
  breaches: BreachStatus[];
  onMutated: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [bucket, setBucket] = useState<CostBucket>("projected_daily");
  const [ceiling, setCeiling] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const usedBuckets = new Set(thresholds.map((t) => t.bucket));
  const availableBuckets = BUCKET_OPTIONS.filter((b) => !usedBuckets.has(b));

  async function handleCreate(reason: string) {
    setError(null);
    const value = Number.parseFloat(ceiling);
    if (!Number.isFinite(value) || value < 0) {
      setError("ceiling must be a non-negative number");
      throw new Error("invalid ceiling");
    }
    try {
      await createCostThreshold({
        metric: "openrouter",
        bucket,
        ceilingValue: value,
        note: note.trim() || null,
        reason,
      });
      setShowCreate(false);
      setCeiling("");
      setNote("");
      onMutated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Cost thresholds</h3>
        {!showCreate && availableBuckets.length > 0 && (
          <button onClick={() => setShowCreate(true)}>Add threshold</button>
        )}
      </div>

      {error && <div className="banner danger" style={{ marginTop: "0.5rem" }}>{error}</div>}

      {showCreate && (
        <div style={{ marginTop: "0.5rem", marginBottom: "0.75rem" }}>
          <div className="field">
            <label>Bucket</label>
            <select value={bucket} onChange={(e) => setBucket(e.target.value as CostBucket)}>
              {availableBuckets.map((b) => (
                <option key={b} value={b}>
                  {BUCKET_LABEL[b]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>
              Ceiling {bucket === "balance_runway_days" ? "(days; breaches BELOW)" : "($USD; breaches ABOVE)"}
            </label>
            <input
              type="number"
              min="0"
              step={bucket === "balance_runway_days" ? "0.5" : "0.01"}
              value={ceiling}
              onChange={(e) => setCeiling(e.target.value)}
              placeholder={bucket === "balance_runway_days" ? "7" : "50.00"}
            />
          </div>
          <div className="field">
            <label>Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Q3 LLM budget guardrail"
              maxLength={200}
            />
          </div>
          <div className="row">
            <ReasonPrompt
              label="Save"
              className="primary"
              onConfirm={(reason) => handleCreate(reason)}
            />
            <button onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      )}

      {thresholds.length === 0 ? (
        <p className="muted">
          No thresholds set. Click <strong>Add threshold</strong> to alert when projected spend
          crosses a ceiling.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Bucket</th>
              <th>Ceiling</th>
              <th>Currently</th>
              <th>State</th>
              <th>Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {thresholds.map((t) => {
              const b = breaches.find((x) => x.threshold_id === t.id);
              return (
                <tr key={t.id}>
                  <td>{BUCKET_LABEL[t.bucket]}</td>
                  <td>{b ? fmtCeiling(b) : fmtUsd(t.ceiling_value)}</td>
                  <td>{b ? fmtObserved(b) : "—"}</td>
                  <td>
                    {b?.breached ? (
                      <span className="pill danger">breached</span>
                    ) : (
                      <span className="pill success">ok</span>
                    )}
                  </td>
                  <td className="muted" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.note ?? ""}
                  </td>
                  <td>
                    <ReasonPrompt
                      label="Disable"
                      onConfirm={async (reason) => {
                        await disableCostThreshold({ id: t.id, reason });
                        onMutated();
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OpenRouterSection({ data }: { data: InfraCost["openrouter"] }) {
  if (!data.configured) {
    return <div className="banner">OpenRouter spend not configured.</div>;
  }
  const burnVsBalance =
    data.prepaid_balance_usd !== null && data.projected_daily_usd > 0
      ? data.prepaid_balance_usd / data.projected_daily_usd
      : null;
  return (
    <>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <MetricCard
          label="Balance"
          value={fmtUsd(data.prepaid_balance_usd)}
          hint={data.prepaid_balance_observed_at ? `as of ${fmtRelative(data.prepaid_balance_observed_at)}` : "—"}
          level={
            data.prepaid_balance_usd === null
              ? "neutral"
              : burnVsBalance !== null && burnVsBalance < 3
                ? "warn"
                : "ok"
          }
        />
        <MetricCard
          label="Trailing 24h"
          value={fmtUsd(data.trailing_24h.spend_usd)}
        />
        <MetricCard
          label="Trailing 7d"
          value={fmtUsd(data.trailing_7d.spend_usd)}
        />
        <MetricCard
          label="Trailing 30d"
          value={fmtUsd(data.trailing_30d.spend_usd)}
        />
        <MetricCard
          label="Projected daily"
          value={fmtUsd(data.projected_daily_usd)}
          hint="from trailing 7d"
        />
        <MetricCard
          label="Projected monthly"
          value={fmtUsd(data.projected_monthly_usd)}
          hint="projected daily × 30"
        />
        {burnVsBalance !== null && (
          <MetricCard
            label="Runway"
            value={`${burnVsBalance.toFixed(1)} days`}
            hint="balance ÷ projected daily"
            level={burnVsBalance < 3 ? "error" : burnVsBalance < 7 ? "warn" : "ok"}
          />
        )}
      </div>

      <AskAgentButton
        context={{
          kind: "openrouter_spend",
          source: "admin.infra.cost",
          subjectRef: { surface: "openrouter" },
          payload: { spend: data },
          defaultQuestion:
            "Look at this OpenRouter spend trend — is anything unusual? Any cost-control suggestions?",
        }}
        label="Ask agent about LLM spend"
      />
    </>
  );
}

function FlySection({ data }: { data: InfraCost["fly"] }) {
  if (!data.configured) {
    return <div className="banner">FLY_API_TOKEN not configured — no machine counts.</div>;
  }
  return (
    <>
      <div className="row" style={{ marginBottom: "0.75rem" }}>
        <MetricCard label="Total machines" value={data.total_machines} hint="across all apps" />
      </div>
      {data.by_app.length === 0 ? (
        <p className="muted">No machines reported.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>App</th>
              <th>Machines</th>
              <th>Regions</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.by_app.map((row) => (
              <tr key={row.app}>
                <td>{row.app}</td>
                <td>{row.machines}</td>
                <td className="muted">{row.regions.join(", ") || "—"}</td>
                <td>
                  <AskAgentButton
                    context={{
                      kind: "fly_app_cost",
                      source: "admin.infra.cost",
                      subjectRef: { app: row.app },
                      payload: { row },
                      defaultQuestion: `Is the machine count for ${row.app} (${row.machines}) right-sized?`,
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
        Fly doesn&apos;t expose an invoiced-spend API. Click into the Fly dashboard for the
        billed number.
      </p>
    </>
  );
}

function CloudflareSection({ data }: { data: InfraCost["cloudflare"] }) {
  if (!data.configured) {
    return <div className="banner">Cloudflare not configured.</div>;
  }
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
      <MetricCard label="Pages projects" value={data.project_count} />
      <MetricCard
        label="Recent deploys"
        value={data.recent_deploys_total}
        hint="sum across projects"
      />
      <span className="muted" style={{ alignSelf: "center", fontSize: "0.85rem" }}>
        AutoFlow stays within Cloudflare&apos;s free tier; deploy activity is the closest
        proxy for "are we doing something unusual?"
      </span>
    </div>
  );
}

function SupabaseSection({ data }: { data: InfraCost["supabase"] }) {
  if (!data.configured) {
    return (
      <div className="banner">
        Set <code className="code">SUPABASE_PROJECT_REF</code> to enable the billing
        deep-link.
      </div>
    );
  }
  return (
    <ul>
      <li>
        <a href={data.billing_url ?? "#"} target="_blank" rel="noreferrer">
          Open Supabase billing ↗
        </a>
      </li>
    </ul>
  );
}

export function InfraCostPage() {
  const qc = useQueryClient();
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["infra-cost"],
    queryFn: fetchInfraCost,
    refetchInterval: 60_000,
  });
  const onMutated = () => {
    void qc.invalidateQueries({ queryKey: ["infra-cost"] });
  };

  return (
    <>
      <InfraTabs />
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.3rem", margin: 0 }}>Infrastructure · Cost</h1>
        <button onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="banner danger">
          {error instanceof Error ? error.message : "Failed to load cost view"}
        </div>
      )}

      {data && <BreachBanner breaches={data.breaches} />}

      {data && (
        <ThresholdsCard
          thresholds={data.thresholds}
          breaches={data.breaches}
          onMutated={onMutated}
        />
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1rem" }}>OpenRouter (LLM spend)</h2>
      {isLoading || !data ? (
        <p className="muted">Loading…</p>
      ) : (
        <OpenRouterSection data={data.openrouter} />
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Fly (compute)</h2>
      {isLoading || !data ? <p className="muted">Loading…</p> : <FlySection data={data.fly} />}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Cloudflare (edge)</h2>
      {isLoading || !data ? <p className="muted">Loading…</p> : <CloudflareSection data={data.cloudflare} />}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Supabase</h2>
      {isLoading || !data ? <p className="muted">Loading…</p> : <SupabaseSection data={data.supabase} />}
    </>
  );
}
