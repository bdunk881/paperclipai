import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Clock3,
  ShieldAlert,
  ShieldCheck,
  Signal,
} from "lucide-react";
import {
  getConnectorHealth,
  type ConnectorHealthRecord,
  type ConnectorHealthState,
  type ConnectorHealthSummary,
} from "../api/client";
import { useAuth } from "../context/AuthContext";

const STATE_STYLES: Record<ConnectorHealthState, string> = {
  healthy: "bg-af2-sage/15 text-emerald-800",
  degraded: "bg-af2-mustard/15 text-amber-800",
  rate_limited: "bg-af2-clay-soft text-af2-clay",
  auth_failed: "bg-af2-clay-soft/60 text-rose-800",
  provider_error: "bg-af2-clay-soft/60 text-af2-clay",
  disabled: "bg-af2-paper-2 text-af2-ink",
};

const STATE_LABELS: Record<ConnectorHealthState, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  rate_limited: "Rate limited",
  auth_failed: "Auth failed",
  provider_error: "Provider error",
  disabled: "Disabled",
};

export default function ConnectorHealth() {
  const { getAccessToken } = useAuth();
  const [connectors, setConnectors] = useState<ConnectorHealthRecord[]>([]);
  const [summary, setSummary] = useState<ConnectorHealthSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const accessToken = (await getAccessToken()) ?? undefined;
        const data = await getConnectorHealth(accessToken);
        if (cancelled) {
          return;
        }
        setConnectors(data.connectors);
        setSummary(data.summary);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load connector health");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  return (
    <div className="space-y-8 p-8">
      <section className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-af2-ink">Connector Health</h1>
          <p className="mt-1 max-w-3xl text-sm text-af2-ink-3">
            Operational view of Tier 1 connector state, recent failures, and alerting
            thresholds across your connected providers.
          </p>
        </div>
        {summary ? (
          <div className="rounded-2xl border border-af2-ink-blue/20 bg-af2-ink-blue/10 px-4 py-3 text-sm text-af2-ink-blue">
            <div className="font-medium">Last updated</div>
            <div>{new Date(summary.lastUpdatedAt).toLocaleString()}</div>
          </div>
        ) : null}
      </section>

      {summary ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <SummaryCard
            label="Healthy"
            value={summary.states.healthy}
            hint={`${summary.total} total connectors`}
            icon={<ShieldCheck className="text-af2-sage" size={18} />}
            tone="bg-af2-sage/10"
          />
          <SummaryCard
            label="Degraded"
            value={summary.states.degraded}
            hint={`Alert after ${summary.alertPolicy.degradedWithinMinutes} minutes`}
            icon={<Activity className="text-af2-mustard" size={18} />}
            tone="bg-af2-mustard/10"
          />
          <SummaryCard
            label="Rate Limited"
            value={summary.states.rate_limited}
            hint={`Threshold ${summary.alertPolicy.rateLimitThreshold15m}/15m`}
            icon={<Signal className="text-af2-clay" size={18} />}
            tone="bg-af2-clay-soft/40"
          />
          <SummaryCard
            label="Auth Failures"
            value={summary.states.auth_failed}
            hint={`Threshold ${summary.alertPolicy.authFailureThreshold15m}/15m`}
            icon={<ShieldAlert className="text-af2-clay" size={18} />}
            tone="bg-af2-clay-soft/30"
          />
          <SummaryCard
            label="Provider Errors"
            value={summary.states.provider_error}
            hint={`Alert after ${summary.alertPolicy.outageThresholdMinutes} minutes`}
            icon={<AlertTriangle className="text-af2-clay" size={18} />}
            tone="bg-af2-clay-soft/30"
          />
          <SummaryCard
            label="Disabled"
            value={summary.states.disabled}
            hint="Not connected or intentionally turned off"
            icon={<Clock3 className="text-af2-ink-2" size={18} />}
            tone="bg-af2-paper-2/40"
          />
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-af2-line bg-af2-card">
          <div className="border-b border-af2-line px-6 py-4">
            <h2 className="font-semibold text-af2-ink">Connector Status Board</h2>
            <p className="text-sm text-af2-ink-3">
              Current state, last good execution, and latest operator-facing error.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-af2-paper-2/40 text-left text-xs uppercase tracking-wide text-af2-ink-3">
                <tr>
                  <th className="px-6 py-3 font-medium">Connector</th>
                  <th className="px-6 py-3 font-medium">State</th>
                  <th className="px-6 py-3 font-medium">24h Success</th>
                  <th className="px-6 py-3 font-medium">Last Success</th>
                  <th className="px-6 py-3 font-medium">Last Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-af2-card text-sm text-af2-ink-2">
                {connectors.map((connector) => (
                  <tr key={connector.connectorKey}>
                    <td className="px-6 py-4">
                      <div className="font-medium text-af2-ink">{connector.connectorName}</div>
                      <div className="mt-1 text-xs uppercase tracking-wide text-af2-ink-4">
                        {connector.connectorKey}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATE_STYLES[connector.state]}`}
                      >
                        {STATE_LABELS[connector.state]}
                      </span>
                    </td>
                    <td className="px-6 py-4">{connector.successRate24h.toFixed(1)}%</td>
                    <td className="px-6 py-4 text-af2-ink-3">
                      {formatTimestamp(connector.lastSuccessAt)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-af2-ink-3">{formatTimestamp(connector.lastErrorAt)}</div>
                      {connector.lastErrorMessage ? (
                        <div className="mt-1 max-w-sm text-xs text-af2-ink-4">
                          {connector.lastErrorMessage}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-af2-line bg-af2-card p-6">
            <h2 className="font-semibold text-af2-ink">Alert Policy</h2>
            {summary ? (
              <div className="mt-4 space-y-3 text-sm text-af2-ink-2">
                <PolicyRow
                  label="Connector-wide degradation"
                  value={`Fire within ${summary.alertPolicy.degradedWithinMinutes} minutes`}
                />
                <PolicyRow
                  label="Repeated auth failures"
                  value={`${summary.alertPolicy.authFailureThreshold15m}+ failures in 15m`}
                />
                <PolicyRow
                  label="Extended rate limiting"
                  value={`${summary.alertPolicy.rateLimitThreshold15m}+ throttles in 15m`}
                />
                <PolicyRow
                  label="Sustained outage"
                  value={`${summary.alertPolicy.outageThresholdMinutes}+ minutes without success`}
                />
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-af2-line bg-af2-card p-6">
            <div className="flex items-center gap-2">
              <Clock3 size={16} className="text-af2-ink-3" />
              <h2 className="font-semibold text-af2-ink">Recent Transitions</h2>
            </div>
            <div className="mt-4 space-y-4">
              {connectors
                .flatMap((connector) =>
                  connector.transitions.map((transition) => ({
                    connectorName: connector.connectorName,
                    ...transition,
                  }))
                )
                .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
                .slice(0, 6)
                .map((transition) => (
                  <div
                    key={`${transition.connectorName}-${transition.at}`}
                    className="border-l-2 border-af2-line pl-4"
                  >
                    <div className="text-sm font-medium text-af2-ink">
                      {transition.connectorName}: {STATE_LABELS[transition.from]} to{" "}
                      {STATE_LABELS[transition.to]}
                    </div>
                    <div className="mt-1 text-xs text-af2-ink-3">
                      {new Date(transition.at).toLocaleString()}
                    </div>
                    <div className="mt-1 text-sm text-af2-ink-2">{transition.reason}</div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-af2-clay/30 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-af2-line bg-af2-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-af2-ink-3">{label}</div>
          <div className="mt-2 text-3xl font-bold text-af2-ink">{value}</div>
        </div>
        <div className={`rounded-xl p-3 ${tone}`}>{icon}</div>
      </div>
      <div className="mt-3 text-xs text-af2-ink-3">{hint}</div>
    </div>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="text-af2-ink-3">{label}</div>
      <div className="text-right font-medium text-af2-ink">{value}</div>
    </div>
  );
}

function formatTimestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : "None";
}
