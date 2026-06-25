/**
 * HEL-822 (parent HEL-701): the builder's Environments panel — deploy a version
 * to dev / staging / prod, see the current deployed version per env, and roll
 * back. Talks to the HEL-820 deploy/rollback API; scheduled/triggered runs then
 * execute the env-deployed version (HEL-821). Version *restore* stays in the
 * existing Versions panel.
 *
 * Self-contained + presentational over the API client so it render-tests
 * without React Flow / the canvas.
 */
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  WORKFLOW_ENVIRONMENTS,
  type WorkflowEnvironment,
  type WorkflowDeployment,
  type CanonicalWorkflowVersionSummary,
  listWorkflowDeployments,
  deployWorkflowVersion,
  rollbackWorkflowVersion,
} from "../../api/workflowsApi";

type Props = {
  workflowId: string | null;
  /** Resolves a fresh access token per request (mirrors the builder's pattern). */
  getAccessToken: () => Promise<string>;
  /** Newest-first version list; [0] is the current draft (latest). */
  versions: CanonicalWorkflowVersionSummary[];
  readonly?: boolean;
};

export function WorkflowEnvironmentsPanel({
  workflowId,
  getAccessToken,
  versions,
  readonly = false,
}: Props) {
  const [env, setEnv] = useState<WorkflowEnvironment>("dev");
  const [current, setCurrent] = useState<Record<WorkflowEnvironment, WorkflowDeployment | null> | null>(
    null,
  );
  const [history, setHistory] = useState<WorkflowDeployment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = versions[0];

  const reload = useCallback(async () => {
    if (!workflowId) return;
    try {
      const token = await getAccessToken();
      const res = await listWorkflowDeployments(workflowId, token);
      setCurrent(res.current);
      setHistory(res.deployments);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deployments");
    }
  }, [workflowId, getAccessToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: (token: string) => Promise<unknown>) => {
    if (readonly || !workflowId) return;
    setBusy(true);
    try {
      const token = await getAccessToken();
      await fn(token);
      await reload();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (!workflowId) {
    return (
      <p className="px-4 py-3 text-xs leading-relaxed text-af2-ink-4">
        Save this workflow to deploy a version to an environment.
      </p>
    );
  }

  const currentForEnv = current?.[env] ?? null;
  const envHistory = history.filter((d) => d.environment === env);

  return (
    <section className="space-y-3 px-4 py-3" data-testid="workflow-environments">
      <div className="flex gap-1" role="tablist" aria-label="Environment">
        {WORKFLOW_ENVIRONMENTS.map((e) => {
          const dep = current?.[e] ?? null;
          return (
            <button
              key={e}
              type="button"
              role="tab"
              aria-selected={e === env}
              className={clsx(
                "flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium capitalize transition",
                e === env
                  ? "border-af2-clay bg-af2-clay-soft text-af2-ink"
                  : "border-af2-line-2 bg-af2-card text-af2-ink-3 hover:border-af2-clay/40",
              )}
              onClick={() => setEnv(e)}
            >
              {e}
              <span className="ml-1 font-mono text-[10px] text-af2-ink-4">
                {dep ? `v${dep.version}` : "—"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-af2-line bg-af2-paper-2 p-2.5 text-xs">
        <p className="text-af2-ink-3">
          Deployed to <span className="font-medium capitalize text-af2-ink">{env}</span>:{" "}
          {currentForEnv ? (
            <span className="font-mono text-af2-ink">v{currentForEnv.version}</span>
          ) : (
            <span className="text-af2-ink-4">nothing yet</span>
          )}
        </p>
        <button
          type="button"
          disabled={busy || readonly || !latest}
          className="mt-2 w-full rounded-lg border border-af2-clay bg-af2-clay px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50"
          onClick={() =>
            latest && run((token) => deployWorkflowVersion(workflowId, env, latest.id, token))
          }
        >
          {latest ? `Deploy draft (v${latest.version}) to ${env}` : "No version to deploy"}
        </button>
      </div>

      {envHistory.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-af2-ink-3">
            {env} deployment history
          </p>
          <ul className="divide-y divide-af2-line rounded-lg border border-af2-line">
            {envHistory.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                <span className="min-w-0 truncate">
                  <span className="font-mono text-af2-ink">v{d.version}</span>
                  {d.note ? <span className="ml-1.5 text-af2-ink-4">· {d.note}</span> : null}
                </span>
                {currentForEnv?.id === d.id ? (
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-af2-sage">
                    current
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy || readonly}
                    className="shrink-0 rounded-md border border-af2-line-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-af2-ink-3 transition hover:border-af2-clay/40 hover:text-af2-clay disabled:opacity-50"
                    onClick={() =>
                      run((token) => rollbackWorkflowVersion(workflowId, env, d.versionId, token))
                    }
                  >
                    Roll back
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="text-xs text-af2-clay" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
