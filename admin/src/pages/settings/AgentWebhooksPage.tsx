import { useCallback, useEffect, useState } from "react";
import {
  createAgentWebhook,
  deleteAgentWebhook,
  listAgentWebhooks,
  testAgentWebhook,
  updateAgentWebhook,
  type AgentWebhook,
} from "../../api/agentWebhooksApi";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function AgentWebhooksPage() {
  const [webhooks, setWebhooks] = useState<AgentWebhook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [hmacSecret, setHmacSecret] = useState("");
  const [customHeadersJson, setCustomHeadersJson] = useState("");

  const refresh = useCallback(async () => {
    try {
      const list = await listAgentWebhooks();
      setWebhooks(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      let customHeaders: Record<string, string> | null = null;
      if (customHeadersJson.trim()) {
        try {
          const parsed = JSON.parse(customHeadersJson);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            customHeaders = {};
            for (const [k, v] of Object.entries(parsed)) {
              if (typeof v !== "string") throw new Error("header values must be strings");
              customHeaders[k] = v;
            }
          } else {
            throw new Error("custom headers must be a JSON object of string:string");
          }
        } catch (err) {
          throw new Error(`Invalid custom headers JSON: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      await createAgentWebhook({
        name: name.trim(),
        url: url.trim(),
        hmacSecret: hmacSecret.trim() || null,
        customHeaders,
        reason: "added via Settings page",
      });
      setName("");
      setUrl("");
      setHmacSecret("");
      setCustomHeadersJson("");
      setCreating(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleDisabled(w: AgentWebhook) {
    setError(null);
    setBusy(true);
    try {
      await updateAgentWebhook(w.id, {
        disabledAt: w.disabled_at ? null : new Date().toISOString(),
        reason: w.disabled_at ? "re-enabled from Settings" : "disabled from Settings",
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(w: AgentWebhook) {
    if (!confirm(`Delete webhook "${w.name}"? This is irreversible.`)) return;
    setError(null);
    setBusy(true);
    try {
      await deleteAgentWebhook(w.id, "deleted from Settings");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleTest(w: AgentWebhook) {
    setError(null);
    setBusy(true);
    try {
      const res = await testAgentWebhook(w.id);
      setTestResult({
        ...testResult,
        [w.id]:
          res.status === "sent"
            ? `Delivered (HTTP ${res.http_status})`
            : `Failed: ${res.error ?? "unknown"} (HTTP ${res.http_status ?? "-"})`,
      });
    } catch (err) {
      setTestResult({
        ...testResult,
        [w.id]: `Failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 style={{ fontSize: "1.3rem", marginBottom: "0.4rem" }}>Agent Webhooks</h1>
      <p className="muted" style={{ marginBottom: "1rem" }}>
        Configure outbound webhooks for the "Ask agent" buttons across the Infra dashboard. We
        POST a JSON payload + your typed question to the URL you specify. No API keys leave
        AutoFlow — your receiver (Slack, n8n, Zapier, internal agent) owns the response. Add an
        HMAC secret if you want to verify our signature on the receiving end.
      </p>

      {error && <div className="banner danger">{error}</div>}

      <div className="card">
        {creating ? (
          <>
            <h2>Add webhook</h2>
            <div className="field">
              <label htmlFor="wh-name">Name</label>
              <input
                id="wh-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Slack #infra-alerts"
                maxLength={120}
              />
            </div>
            <div className="field">
              <label htmlFor="wh-url">URL (https only)</label>
              <input
                id="wh-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/T/B/X"
              />
            </div>
            <div className="field">
              <label htmlFor="wh-secret">HMAC secret (optional)</label>
              <input
                id="wh-secret"
                value={hmacSecret}
                onChange={(e) => setHmacSecret(e.target.value)}
                placeholder="Shared with your receiver for X-AutoFlow-Signature verification"
              />
            </div>
            <div className="field">
              <label htmlFor="wh-headers">Custom headers (optional, JSON object)</label>
              <textarea
                id="wh-headers"
                rows={3}
                value={customHeadersJson}
                onChange={(e) => setCustomHeadersJson(e.target.value)}
                placeholder={`{ "Authorization": "Bearer abc..." }`}
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              />
            </div>
            <div className="row">
              <button className="primary" onClick={handleCreate} disabled={busy || !name.trim() || !url.trim()}>
                Save
              </button>
              <button onClick={() => setCreating(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button className="primary" onClick={() => setCreating(true)}>
            Add webhook
          </button>
        )}
      </div>

      <div className="card">
        <h2>Configured webhooks</h2>
        {webhooks === null ? (
          <span className="muted">Loading…</span>
        ) : webhooks.length === 0 ? (
          <p className="muted">No webhooks yet. Add one above to enable Ask-an-Agent buttons.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>HMAC</th>
                <th>Headers</th>
                <th>Last used</th>
                <th>State</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td className="code" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {w.url}
                  </td>
                  <td>{w.secret_present ? "set" : "—"}</td>
                  <td>{w.custom_headers_present ? "set" : "—"}</td>
                  <td>{formatDate(w.last_used_at)}</td>
                  <td>
                    {w.disabled_at ? (
                      <span className="pill warning">disabled</span>
                    ) : (
                      <span className="pill success">active</span>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ gap: "0.3rem" }}>
                      <button onClick={() => handleTest(w)} disabled={busy || !!w.disabled_at}>
                        Test
                      </button>
                      <button onClick={() => handleToggleDisabled(w)} disabled={busy}>
                        {w.disabled_at ? "Enable" : "Disable"}
                      </button>
                      <button onClick={() => handleDelete(w)} disabled={busy}>
                        Delete
                      </button>
                    </div>
                    {testResult[w.id] && (
                      <div className="muted" style={{ marginTop: "0.25rem" }}>
                        {testResult[w.id]}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
