import { useEffect, useState } from "react";
import { listAgentWebhooks, sendAsk, type AgentWebhook } from "../../api/agentWebhooksApi";

export interface AskAgentContext {
  kind: string;
  source: string;
  subjectRef?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  defaultQuestion?: string;
}

export interface AskAgentModalProps {
  open: boolean;
  context: AskAgentContext | null;
  onClose: () => void;
}

export function AskAgentModal({ open, context, onClose }: AskAgentModalProps) {
  const [webhooks, setWebhooks] = useState<AgentWebhook[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    status: string;
    httpStatus: number | null;
    excerpt: string | null;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setResult(null);
    setQuestion(context?.defaultQuestion ?? "");
    listAgentWebhooks()
      .then((list) => {
        const active = list.filter((w) => !w.disabled_at);
        setWebhooks(active);
        if (active.length > 0 && !selectedId) setSelectedId(active[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, context]);

  async function handleSend() {
    if (!context) return;
    if (!selectedId) {
      setError("Pick a webhook to send to.");
      return;
    }
    if (!question.trim()) {
      setError("Enter a question for the agent.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await sendAsk({
        webhookId: selectedId,
        kind: context.kind,
        source: context.source,
        subjectRef: context.subjectRef,
        payload: context.payload,
        adminQuestion: question.trim(),
      });
      setResult({ status: res.status, httpStatus: res.http_status, excerpt: res.excerpt });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open || !context) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ask-agent-title">
      <div className="modal-dialog" style={{ maxWidth: 600 }}>
        <h2 id="ask-agent-title">Ask an agent</h2>
        <p className="muted">
          Send this {context.kind} to a configured webhook with your question. The receiver (Slack,
          n8n, internal agent, etc.) handles the response.
        </p>

        {error && <div className="banner danger" style={{ marginBottom: "0.75rem" }}>{error}</div>}

        <div className="field">
          <label htmlFor="webhook-pick">Webhook</label>
          {webhooks === null ? (
            <div className="muted">Loading…</div>
          ) : webhooks.length === 0 ? (
            <div className="muted">
              No active webhooks. Add one under Settings → Agent Webhooks first.
            </div>
          ) : (
            <select
              id="webhook-pick"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {webhooks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.url.length > 50 ? `${w.url.slice(0, 50)}…` : w.url})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="field">
          <label>Payload preview</label>
          <pre
            className="code"
            style={{
              maxHeight: 200,
              overflow: "auto",
              padding: "0.5rem",
              background: "#f4f5f7",
              margin: 0,
            }}
          >
            {JSON.stringify(
              {
                kind: context.kind,
                source: context.source,
                subject_ref: context.subjectRef ?? {},
                payload: context.payload ?? {},
              },
              null,
              2,
            )}
          </pre>
        </div>

        <div className="field">
          <label htmlFor="ask-question">Your question</label>
          <textarea
            id="ask-question"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What do you want the agent to do with this?"
          />
        </div>

        {result && (
          <div
            className={`banner${result.status !== "sent" ? " danger" : ""}`}
            style={{ marginBottom: "0.75rem" }}
          >
            <strong>{result.status === "sent" ? "Delivered" : "Failed"}</strong>{" "}
            {result.httpStatus ? `(HTTP ${result.httpStatus})` : ""}
            {result.excerpt && (
              <pre style={{ whiteSpace: "pre-wrap", margin: "0.4rem 0 0 0" }}>{result.excerpt}</pre>
            )}
          </div>
        )}

        <div className="row">
          <button
            className="primary"
            onClick={handleSend}
            disabled={busy || webhooks === null || webhooks.length === 0}
          >
            {busy ? "Sending…" : "Send to agent"}
          </button>
          <button onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
