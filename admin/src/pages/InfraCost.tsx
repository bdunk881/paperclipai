import { useQuery } from "@tanstack/react-query";
import { fetchInfraCost, type InfraCost } from "../api/costApi";
import { InfraTabs } from "../components/infra/InfraTabs";
import { MetricCard } from "../components/infra/MetricCard";
import { AskAgentButton } from "../components/agent/AskAgentButton";

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
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["infra-cost"],
    queryFn: fetchInfraCost,
    refetchInterval: 60_000,
  });

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
