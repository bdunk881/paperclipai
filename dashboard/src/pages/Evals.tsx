/**
 * Evals hub (HEL-787) — the dashboard surface on the eval API (HEL-776).
 *
 * Lists a workspace's evals and offers a "New eval" form: pick a workflow
 * template, paste a dataset of { input, expected } rows, and run it. The eval
 * runs ALWAYS as a dry run server-side (no real webhooks / writes fire), so
 * there is no live/dry toggle here. Submitting navigates to the results page.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { listTemplates, type TemplateSummary } from "../api/client";
import {
  createEval,
  listEvals,
  type EvalDatasetRow,
  type EvalListItem,
} from "../api/evalsApi";
import { ErrorState, LoadingState } from "../components/UiStates";

const EXAMPLE_DATASET = `[
  { "input": { "ticketId": "T-1" }, "expected": { "label": "billing" } },
  { "input": { "ticketId": "T-2" }, "expected": { "label": "sales" } }
]`;

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Parse + validate the dataset textarea into rows the API accepts. */
function parseDataset(text: string): { ok: true; rows: EvalDatasetRow[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Dataset is not valid JSON: ${(err as Error).message}` };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ok: false, error: "Dataset must be a non-empty JSON array of { input, expected } rows." };
  }
  const rows: EvalDatasetRow[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i] as Record<string, unknown> | null;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, error: `Row ${i + 1} must be an object with an "input" field.` };
    }
    const input = row.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { ok: false, error: `Row ${i + 1} is missing an "input" object.` };
    }
    const expected = row.expected;
    if (expected !== undefined && (typeof expected !== "object" || expected === null || Array.isArray(expected))) {
      return { ok: false, error: `Row ${i + 1}'s "expected" must be an object when present.` };
    }
    rows.push({
      input: input as Record<string, unknown>,
      ...(expected !== undefined ? { expected: expected as Record<string, unknown> } : {}),
    });
  }
  return { ok: true, rows };
}

export default function Evals() {
  const { requireAccessToken } = useAuth();
  const navigate = useNavigate();

  const [evals, setEvals] = useState<EvalListItem[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [datasetText, setDatasetText] = useState(EXAMPLE_DATASET);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const [evalList, templateList] = await Promise.all([
        listEvals(token),
        listTemplates().catch(() => [] as TemplateSummary[]),
      ]);
      setEvals(evalList.evals);
      setTemplates(templateList);
      if (!templateId && templateList.length > 0) {
        setTemplateId(templateList[0]!.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load evals");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken, templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const datasetCount = useMemo(() => {
    const parsed = parseDataset(datasetText);
    return parsed.ok ? parsed.rows.length : null;
  }, [datasetText]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreateError(null);
    if (!templateId) {
      setCreateError("Pick a workflow to evaluate.");
      return;
    }
    const parsed = parseDataset(datasetText);
    if (!parsed.ok) {
      setCreateError(parsed.error);
      return;
    }
    setCreating(true);
    try {
      const token = await requireAccessToken();
      const result = await createEval(token, {
        templateId,
        dataset: parsed.rows,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      navigate(`/evals/${result.evalId}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to start eval");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="af2-page text-af2-ink" style={{ maxWidth: 920 }}>
        <LoadingState label="Loading evals…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="af2-page text-af2-ink" style={{ maxWidth: 920 }}>
        <ErrorState title="Couldn't load evals" message={error} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="af2-page text-af2-ink" style={{ maxWidth: 920 }}>
      <div className="af2-page-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div className="af2-eyebrow">Build · Evals</div>
          <h1 style={{ margin: "4px 0 0", fontSize: 22 }}>Evals</h1>
          <p style={{ margin: "6px 0 0", color: "var(--af2-ink-soft, #6b7280)", fontSize: 13 }}>
            Run a workflow over a dataset and measure its output against expected. Every eval is a
            dry run — no real webhooks, writes, or emails fire.
          </p>
        </div>
        <button
          type="button"
          className="af2-btn af2-btn-primary"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Close" : "New eval"}
        </button>
      </div>

      {showForm && (
        <form className="af2-card" style={{ padding: 16, marginBottom: 18 }} onSubmit={handleCreate}>
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Workflow</span>
              <select
                className="af2-input"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                {templates.length === 0 && <option value="">No workflows available</option>}
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Name (optional)</span>
              <input
                className="af2-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ticket routing accuracy"
              />
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                Dataset — JSON array of {"{ input, expected }"} rows
                {datasetCount !== null && (
                  <span style={{ color: "var(--af2-ink-soft, #6b7280)", fontWeight: 400 }}>
                    {" "}· {datasetCount} {datasetCount === 1 ? "case" : "cases"}
                  </span>
                )}
              </span>
              <textarea
                className="af2-input"
                style={{ fontFamily: "var(--af2-mono)", minHeight: 160, resize: "vertical" }}
                value={datasetText}
                onChange={(e) => setDatasetText(e.target.value)}
                spellCheck={false}
              />
              <span style={{ fontSize: 11, color: "var(--af2-ink-soft, #6b7280)" }}>
                Each row’s <code>expected</code> is optional — omit it to compare against the
                workflow’s default expected output. A field can be an exact value or a matcher,
                e.g. <code>{`{ "$contains": "refund" }`}</code> or <code>{`{ "$gte": 0.8 }`}</code>.
              </span>
            </label>

            {createError && (
              <div style={{ color: "var(--af2-danger, #b91c1c)", fontSize: 13 }}>{createError}</div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="af2-btn af2-btn-primary" disabled={creating}>
                {creating ? "Starting…" : "Run eval"}
              </button>
              <button
                type="button"
                className="af2-btn af2-btn-ghost"
                onClick={() => setShowForm(false)}
                disabled={creating}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {evals.length === 0 ? (
        <div className="af2-card" style={{ padding: 24, textAlign: "center", color: "var(--af2-ink-soft, #6b7280)" }}>
          No evals yet. Click <strong>New eval</strong> to run a workflow over a dataset.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {evals.map((ev) => (
            <Link
              key={ev.id}
              to={`/evals/${ev.id}`}
              className="af2-card"
              style={{
                padding: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{ev.name}</div>
                <div style={{ fontSize: 12, color: "var(--af2-ink-soft, #6b7280)", marginTop: 2 }}>
                  {ev.templateId ?? "workflow"} · {ev.total} {ev.total === 1 ? "case" : "cases"}
                  {ev.createdAt ? ` · ${formatRelative(ev.createdAt)}` : ""}
                </div>
              </div>
              <span style={{ color: "var(--af2-clay)", fontSize: 13 }}>View →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
