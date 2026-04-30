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

const STATE_STYLES: Record<ConnectorHealthState, string> = {
  healthy: "bg-emerald-100 text-emerald-800",
  degraded: "bg-amber-100 text-amber-800",
  rate_limited: "bg-orange-100 text-orange-800",
  auth_failed: "bg-rose-100 text-rose-800",
  provider_error: "bg-red-100 text-red-800",
  disabled: "bg-slate-100 text-slate-800",
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
  const [connectors, setConnectors] = useState<ConnectorHealthRecord[]>([]);
  const [summary, setSummary] = useState<ConnectorHealthSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConnectorHealth()
      .then((data) => {
        setConnectors(data.connectors);
        setSummary(data.summary);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load connector health");
      });
  }, []);

  return (
    <div className="space-y-8 p-8">
      <section className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Connector Health</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Operational view of Tier 1 connector state, recent failures, and alerting
            thresholds. This scaffold is wired to mock telemetry until the connector
            health-state model from `ALT-1945` is emitting live data.
          </p>
        </div>
        {summary ? (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
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
            icon={<ShieldCheck className="text-emerald-600" size={18} />}
            tone="bg-emerald-50"
          />
          <SummaryCard
            label="Degraded"
            value={summary.states.degraded}
            hint={`Alert after ${summary.alertPolicy.degradedWithinMinutes} minutes`}
            icon={<Activity className="text-amber-600" size={18} />}
            tone="bg-amber-50"
          />
          <SummaryCard
            label="Rate Limited"
            value={summary.states.rate_limited}
            hint={`Threshold ${summary.alertPolicy.rateLimitThreshold15m}/15m`}
            icon={<Signal className="text-orange-600" size={18} />}
            tone="bg-orange-50"
          />
          <SummaryCard
            label="Auth Failures"
            value={summary.states.auth_failed}
            hint={`Threshold ${summary.alertPolicy.authFailureThreshold15m}/15m`}
            icon={<ShieldAlert className="text-rose-600" size={18} />}
            tone="bg-rose-50"
          />
          <SummaryCard
            label="Provider Errors"
            value={summary.states.provider_error}
            hint={`Alert after ${summary.alertPolicy.outageThresholdMinutes} minutes`}
            icon={<AlertTriangle className="text-red-600" size={18} />}
            tone="bg-red-50"
          />
          <SummaryCard
            label="Disabled"
            value={summary.states.disabled}
            hint="Not connected or intentionally turned off"
            icon={<Clock3 className="text-slate-600" size={18} />}
            tone="bg-slate-50"
          />
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="font-semibold text-gray-900">Connector Status Board</h2>
            <p className="text-sm text-gray-500">
              Current state, last good execution, and latest operator-facing error.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Connector</th>
                  <th className="px-6 py-3 font-medium">State</th>
                  <th className="px-6 py-3 font-medium">24h Success</th>
                  <th className="px-6 py-3 font-medium">Last Success</th>
                  <th className="px-6 py-3 font-medium">Last Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white text-sm text-gray-700">
                {connectors.map((connector) => (
                  <tr key={connector.connectorKey}>
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{connector.connectorName}</div>
                      <div className="mt-1 text-xs uppercase tracking-wide text-gray-400">
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
                    <td className="px-6 py-4 text-gray-500">
                      {formatTimestamp(connector.lastSuccessAt)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-gray-500">{formatTimestamp(connector.lastErrorAt)}</div>
                      {connector.lastErrorMessage ? (
                        <div className="mt-1 max-w-sm text-xs text-gray-400">
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
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-900">Alert Policy</h2>
            {summary ? (
              <div className="mt-4 space-y-3 text-sm text-gray-600">
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

          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="flex items-center gap-2">
              <Clock3 size={16} className="text-gray-500" />
              <h2 className="font-semibold text-gray-900">Recent Transitions</h2>
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
                    className="border-l-2 border-gray-200 pl-4"
                  >
                    <div className="text-sm font-medium text-gray-900">
                      {transition.connectorName}: {STATE_LABELS[transition.from]} to{" "}
                      {STATE_LABELS[transition.to]}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {new Date(transition.at).toLocaleString()}
                    </div>
                    <div className="mt-1 text-sm text-gray-600">{transition.reason}</div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-500">{label}</div>
          <div className="mt-2 text-3xl font-bold text-gray-900">{value}</div>
        </div>
        <div className={`rounded-xl p-3 ${tone}`}>{icon}</div>
      </div>
      <div className="mt-3 text-xs text-gray-500">{hint}</div>
    </div>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="text-gray-500">{label}</div>
      <div className="text-right font-medium text-gray-900">{value}</div>
    </div>
  );
}

function formatTimestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : "None";
}
