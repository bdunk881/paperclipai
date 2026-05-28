import { useEffect, useState } from "react";
import { fetchJobDetail, type JobDetail } from "../../api/queuesApi";
import { promoteJob, removeJob, replayDlqJob, retryJob } from "../../api/computeMutationsApi";
import { AskAgentButton } from "../agent/AskAgentButton";
import { ReasonPrompt } from "../ReasonPrompt";

export interface JobInspectorModalProps {
  queueName: string;
  jobId: string | null;
  onClose: () => void;
  /** Called after a mutation (retry/promote/remove/replay) completes so the queue inspector can refresh. */
  onMutated?: () => void;
}

function formatDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <div style={{ fontSize: "0.78rem", color: "#586271", textTransform: "uppercase", marginBottom: "0.25rem" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function CodeBlock({ value }: { value: unknown }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: "0.5rem",
        background: "#f4f5f7",
        borderRadius: "4px",
        fontSize: "0.82rem",
        maxHeight: 220,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function JobInspectorModal({ queueName, jobId, onClose, onMutated }: JobInspectorModalProps) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function runMutation(label: string, fn: () => Promise<unknown>) {
    setError(null);
    setActionMessage(null);
    try {
      const result = await fn();
      const id =
        result && typeof result === "object" && "new_job_id" in (result as Record<string, unknown>)
          ? String((result as { new_job_id: string }).new_job_id)
          : null;
      setActionMessage(id ? `${label} → new job ${id}` : `${label} succeeded`);
      onMutated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (!jobId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchJobDetail(queueName, jobId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queueName, jobId]);

  if (!jobId) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="job-inspector-title">
      <div className="modal-dialog" style={{ maxWidth: 760, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 id="job-inspector-title" style={{ margin: 0 }}>
            Job {jobId}
          </h2>
          <button onClick={onClose}>Close</button>
        </div>

        {error && <div className="banner danger">{error}</div>}
        {loading && !detail && <div className="muted">Loading…</div>}

        {detail && (
          <>
            <div className="row" style={{ marginTop: "0.5rem", marginBottom: "0.75rem" }}>
              <span className={`pill ${detail.state === "failed" ? "danger" : detail.state === "completed" ? "success" : ""}`}>
                {detail.state}
              </span>
              <span className="muted">{detail.name}</span>
              <span className="muted">
                attempts {detail.attempts_made}
                {detail.attempts_total !== null ? `/${detail.attempts_total}` : ""}
              </span>
              <span style={{ marginLeft: "auto" }}>
                <AskAgentButton
                  context={{
                    kind: "queue_job",
                    source: "admin.infra.compute.queue-inspector",
                    subjectRef: { queue: queueName, job_id: detail.id, state: detail.state },
                    payload: {
                      data: detail.data,
                      failed_reason: detail.failed_reason,
                      stacktrace: detail.stacktrace,
                      attempts_made: detail.attempts_made,
                    },
                    defaultQuestion:
                      detail.state === "failed"
                        ? "This job failed — what's the root cause and how would you fix it?"
                        : "What is this job doing?",
                  }}
                  label="Ask agent"
                />
              </span>
            </div>

            <div className="row" style={{ marginBottom: "0.75rem", fontSize: "0.85rem", color: "#586271" }}>
              <span>created {formatDate(detail.timestamp)}</span>
              <span>processed {formatDate(detail.processed_on)}</span>
              <span>finished {formatDate(detail.finished_on)}</span>
            </div>

            <Section title="Data">
              <CodeBlock value={detail.data} />
            </Section>

            {detail.return_value !== null && (
              <Section title="Return value">
                <CodeBlock value={detail.return_value} />
              </Section>
            )}

            {detail.failed_reason && (
              <Section title="Failed reason">
                <CodeBlock value={detail.failed_reason} />
              </Section>
            )}

            {detail.stacktrace.length > 0 && (
              <Section title={`Stacktrace (${detail.stacktrace.length})`}>
                <CodeBlock value={detail.stacktrace.join("\n\n")} />
              </Section>
            )}

            {detail.logs.length > 0 && (
              <Section title={`Logs (${detail.logs.length})`}>
                <CodeBlock value={detail.logs.join("\n")} />
              </Section>
            )}

            <Section title="Options">
              <CodeBlock value={detail.opts} />
            </Section>

            {actionMessage && (
              <div className="banner" style={{ marginTop: "0.5rem" }}>
                {actionMessage}
              </div>
            )}

            <div className="row" style={{ marginTop: "0.75rem", flexWrap: "wrap", gap: "0.4rem" }}>
              {detail.state === "failed" && (
                <ReasonPrompt
                  label="Retry"
                  className="primary"
                  onConfirm={(reason) =>
                    runMutation("Retry", () => retryJob({ queueName, jobId: detail.id, reason }))
                  }
                />
              )}
              {detail.state === "delayed" && (
                <ReasonPrompt
                  label="Promote"
                  className="primary"
                  onConfirm={(reason) =>
                    runMutation("Promote", () => promoteJob({ queueName, jobId: detail.id, reason }))
                  }
                />
              )}
              {queueName === "runs-dlq" && (
                <ReasonPrompt
                  label="Replay to runs"
                  className="primary"
                  onConfirm={(reason) =>
                    runMutation("Replay", () => replayDlqJob({ jobId: detail.id, reason }))
                  }
                />
              )}
              <ReasonPrompt
                label="Remove"
                className="danger"
                onConfirm={(reason) =>
                  runMutation("Remove", () => removeJob({ queueName, jobId: detail.id, reason }))
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
