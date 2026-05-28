import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchInfraEdge,
  type CFPagesDeployment,
  type CFPagesProjectView,
  type SentryIssue,
  type SentryProjectRollup,
  type WorkflowRun,
  type WorkflowRunsView,
} from "../api/edgeApi";
import {
  cancelWorkflowRun,
  rerunWorkflowRun,
  retryCfDeploy,
  rollbackCfDeploy,
} from "../api/edgeMutationsApi";
import { AskAgentButton } from "../components/agent/AskAgentButton";
import { InfraTabs } from "../components/infra/InfraTabs";
import { ReasonPrompt } from "../components/ReasonPrompt";
import { DangerActionPrompt } from "../components/infra/DangerActionPrompt";

function shortTimeAgo(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function statusPillClass(status: string | undefined | null): string {
  if (!status) return "";
  const s = status.toLowerCase();
  if (["success", "completed"].includes(s)) return "success";
  if (["failure", "failed", "cancelled"].includes(s)) return "danger";
  if (["queued", "in_progress", "running"].includes(s)) return "warning";
  return "";
}

function CloudflareDeploymentRow({
  projectName,
  d,
  onMutated,
}: {
  projectName: string;
  d: CFPagesDeployment;
  onMutated: () => void;
}) {
  const status = d.latest_stage_status ?? "unknown";
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const canRollback = d.environment === "production" && status === "success";
  const canRetry = status === "failure" || status === "failed";
  return (
    <tr>
      <td className="code">{d.short_id ?? d.id.slice(0, 10)}</td>
      <td>{d.environment ?? "—"}</td>
      <td>
        <span className={`pill ${statusPillClass(status)}`}>{status}</span>
      </td>
      <td>{d.source_branch ?? "—"}</td>
      <td className="code">{d.source_commit_hash?.slice(0, 8) ?? "—"}</td>
      <td className="muted" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {d.source_commit_message ?? ""}
      </td>
      <td>{shortTimeAgo(d.modified_on ?? d.created_on)}</td>
      <td>
        {d.url ? (
          <a href={d.url} target="_blank" rel="noreferrer">
            open ↗
          </a>
        ) : (
          "—"
        )}
      </td>
      <td>
        <div className="row" style={{ gap: "0.3rem" }}>
          {canRetry && (
            <ReasonPrompt
              label="Retry"
              onConfirm={async (reason) => {
                await retryCfDeploy({ project: projectName, deploymentId: d.id, reason });
                onMutated();
              }}
            />
          )}
          {canRollback && (
            <button className="danger" onClick={() => setRollbackOpen(true)}>
              Rollback
            </button>
          )}
          <AskAgentButton
            context={{
              kind: "cf_deploy",
              source: "admin.infra.edge",
              subjectRef: {
                project: projectName,
                deployment_id: d.id,
                status,
                branch: d.source_branch,
              },
              payload: { deployment: d },
              defaultQuestion:
                status === "failure"
                  ? "This Cloudflare Pages deploy failed — what's the likely cause from the stages?"
                  : "Summarize this CF Pages deploy.",
            }}
          />
        </div>
        <DangerActionPrompt
          open={rollbackOpen}
          title={`Rollback ${projectName} to ${d.short_id ?? d.id.slice(0, 8)}`}
          description={
            <>
              Promotes this deployment back to production. Customers will start serving from
              the rolled-back build within ~60 seconds.
            </>
          }
          typedConfirm="ROLLBACK"
          confirmLabel="Roll back production"
          acknowledgementText="I've verified this is the right target deployment."
          onClose={() => setRollbackOpen(false)}
          onConfirm={async ({ reason }) => {
            await rollbackCfDeploy({
              project: projectName,
              deploymentId: d.id,
              reason,
              confirm: "ROLLBACK",
            });
            onMutated();
          }}
        />
      </td>
    </tr>
  );
}

function CloudflareProject({
  view,
  onMutated,
}: {
  view: CFPagesProjectView;
  onMutated: () => void;
}) {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{view.project_name}</h3>
        <AskAgentButton
          context={{
            kind: "cf_project",
            source: "admin.infra.edge",
            subjectRef: { project: view.project_name },
            payload: { view },
            defaultQuestion: `What's the deploy health of ${view.project_name}?`,
          }}
          label={`Ask agent about ${view.project_name}`}
        />
      </div>
      {view.error ? (
        <div className="banner danger">{view.error}</div>
      ) : view.deployments.length === 0 ? (
        <p className="muted">No deployments returned.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Id</th>
              <th>Env</th>
              <th>Status</th>
              <th>Branch</th>
              <th>Commit</th>
              <th>Message</th>
              <th>Updated</th>
              <th>URL</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {view.deployments.map((d) => (
              <CloudflareDeploymentRow
                key={d.id}
                projectName={view.project_name}
                d={d}
                onMutated={onMutated}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SentryIssueRow({ projectSlug, issue }: { projectSlug: string; issue: SentryIssue }) {
  return (
    <tr>
      <td className="code">{issue.shortId || issue.id.slice(0, 8)}</td>
      <td>
        <span className={`pill ${issue.level === "error" ? "danger" : issue.level === "warning" ? "warning" : ""}`}>
          {issue.level}
        </span>
      </td>
      <td style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {issue.title}
      </td>
      <td className="muted">{issue.count}</td>
      <td className="muted">{issue.userCount}</td>
      <td>{shortTimeAgo(issue.lastSeen)}</td>
      <td>
        {issue.permalink ? (
          <a href={issue.permalink} target="_blank" rel="noreferrer">
            open ↗
          </a>
        ) : (
          "—"
        )}
      </td>
      <td>
        <AskAgentButton
          context={{
            kind: "sentry_issue",
            source: "admin.infra.edge",
            subjectRef: {
              project: projectSlug,
              issue_id: issue.id,
              short_id: issue.shortId,
              level: issue.level,
            },
            payload: { issue },
            defaultQuestion: `Root-cause this Sentry issue: ${issue.title}`,
          }}
        />
      </td>
    </tr>
  );
}

function SentryProject({ rollup }: { rollup: SentryProjectRollup }) {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{rollup.project_slug}</h3>
        <div className="row" style={{ gap: "0.5rem" }}>
          <span
            className={`pill ${
              rollup.unresolved_24h === null ? "" : rollup.unresolved_24h > 0 ? "warning" : "success"
            }`}
          >
            {rollup.unresolved_24h === null ? "—" : `${rollup.unresolved_24h} unresolved`}
          </span>
          <AskAgentButton
            context={{
              kind: "sentry_project",
              source: "admin.infra.edge",
              subjectRef: { project: rollup.project_slug },
              payload: { rollup },
              defaultQuestion: `Triage the unresolved Sentry issues for ${rollup.project_slug}.`,
            }}
            label="Ask agent"
          />
        </div>
      </div>
      {rollup.error ? (
        <div className="banner danger">{rollup.error}</div>
      ) : rollup.top_issues.length === 0 ? (
        <p className="muted">No unresolved issues in the last 24h.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Id</th>
              <th>Level</th>
              <th>Title</th>
              <th>Events</th>
              <th>Users</th>
              <th>Last seen</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rollup.top_issues.map((i) => (
              <SentryIssueRow key={i.id} projectSlug={rollup.project_slug} issue={i} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function WorkflowRunRow({
  workflowFile,
  run,
  onMutated,
}: {
  workflowFile: string;
  run: WorkflowRun;
  onMutated: () => void;
}) {
  const result = run.conclusion ?? run.status ?? "unknown";
  const canRerun = result === "failure" || result === "cancelled" || result === "completed";
  const canCancel = run.status === "in_progress" || run.status === "queued";
  return (
    <tr>
      <td className="code">#{run.run_number}</td>
      <td>
        <span className={`pill ${statusPillClass(run.conclusion ?? run.status)}`}>{result}</span>
      </td>
      <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {run.display_title}
      </td>
      <td>{run.head_branch ?? "—"}</td>
      <td className="muted">
        {run.duration_seconds !== null && run.duration_seconds !== undefined
          ? `${Math.floor(run.duration_seconds / 60)}m ${run.duration_seconds % 60}s`
          : "—"}
      </td>
      <td>{shortTimeAgo(run.updated_at)}</td>
      <td>
        <a href={run.html_url} target="_blank" rel="noreferrer">
          open ↗
        </a>
      </td>
      <td>
        <div className="row" style={{ gap: "0.3rem" }}>
          {canRerun && (
            <ReasonPrompt
              label={result === "failure" ? "Rerun failed" : "Rerun"}
              onConfirm={async (reason) => {
                await rerunWorkflowRun({
                  runId: run.id,
                  reason,
                  onlyFailed: result === "failure",
                });
                onMutated();
              }}
            />
          )}
          {canCancel && (
            <ReasonPrompt
              label="Cancel"
              className="danger"
              onConfirm={async (reason) => {
                await cancelWorkflowRun({ runId: run.id, reason });
                onMutated();
              }}
            />
          )}
          <AskAgentButton
            context={{
              kind: "workflow_run",
              source: "admin.infra.edge",
              subjectRef: {
                workflow: workflowFile,
                run_id: run.id,
                run_number: run.run_number,
                conclusion: run.conclusion,
              },
              payload: { run },
              defaultQuestion:
                run.conclusion === "failure"
                  ? "This workflow run failed — what's the likely cause?"
                  : "Summarize this workflow run.",
            }}
          />
        </div>
      </td>
    </tr>
  );
}

function WorkflowFile({
  view,
  onMutated,
}: {
  view: WorkflowRunsView;
  onMutated: () => void;
}) {
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{view.workflow_file}</h3>
        <AskAgentButton
          context={{
            kind: "workflow_file",
            source: "admin.infra.edge",
            subjectRef: { workflow: view.workflow_file },
            payload: { view },
          }}
          label="Ask agent"
        />
      </div>
      {view.error ? (
        <div className="banner danger">{view.error}</div>
      ) : view.runs.length === 0 ? (
        <p className="muted">No recent runs.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Result</th>
              <th>Title</th>
              <th>Branch</th>
              <th>Duration</th>
              <th>Updated</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {view.runs.map((r) => (
              <WorkflowRunRow
                key={r.id}
                workflowFile={view.workflow_file}
                run={r}
                onMutated={onMutated}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function InfraEdgePage() {
  const qc = useQueryClient();
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["infra-edge"],
    queryFn: fetchInfraEdge,
    refetchInterval: 30_000,
  });
  const onMutated = () => {
    void qc.invalidateQueries({ queryKey: ["infra-edge"] });
  };

  return (
    <>
      <InfraTabs />
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.3rem", margin: 0 }}>Infrastructure · Edge</h1>
        <button onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="banner danger">
          {error instanceof Error ? error.message : "Failed to load edge view"}
        </div>
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1rem" }}>Cloudflare Pages</h2>
      {isLoading || !data ? (
        <p className="muted">Loading…</p>
      ) : !data.cloudflare.configured ? (
        <div className="banner">
          CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not configured for this environment.
        </div>
      ) : (
        data.cloudflare.projects.map((p) => (
          <CloudflareProject key={p.project_name} view={p} onMutated={onMutated} />
        ))
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Sentry</h2>
      {isLoading || !data ? (
        <p className="muted">Loading…</p>
      ) : !data.sentry.configured ? (
        <div className="banner">
          SENTRY_API_TOKEN / SENTRY_ORG_SLUG not configured for this environment.
        </div>
      ) : (
        data.sentry.rollups.map((r) => <SentryProject key={r.project_slug} rollup={r} />)
      )}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>GitHub Actions · pinned workflows</h2>
      {isLoading || !data ? (
        <p className="muted">Loading…</p>
      ) : !data.github_actions.configured ? (
        <div className="banner">GITHUB_TOKEN not configured for this environment.</div>
      ) : (
        data.github_actions.workflows.map((w) => (
          <WorkflowFile key={w.workflow_file} view={w} onMutated={onMutated} />
        ))
      )}

    </>
  );
}
