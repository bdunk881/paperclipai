#!/usr/bin/env node

const accountId = mustGetEnv("CLOUDFLARE_ACCOUNT_ID");
const apiToken = mustGetEnv("CLOUDFLARE_API_TOKEN");
const projectName = process.env.CF_PAGES_INSPECT_PROJECT || "autoflow-dashboard-git";

const result = {
  project_name: projectName,
  fetched_at: new Date().toISOString(),
};

const project = await cfApi(`/accounts/${accountId}/pages/projects/${projectName}`);
result.project_exists = Boolean(project?.result);
if (project?.result) {
  const p = project.result;
  result.project = {
    id: p.id,
    name: p.name,
    subdomain: p.subdomain,
    domains: p.domains,
    production_branch: p.production_branch,
    created_on: p.created_on,
    canonical_deployment_id: p.canonical_deployment?.id ?? null,
    latest_deployment_id: p.latest_deployment?.id ?? null,
    source_type: p.source?.type ?? null,
    source_config: p.source?.config ?? null,
    build_config: p.build_config,
    deployment_configs_keys: Object.keys(p.deployment_configs ?? {}),
  };
}

const deployments = await cfApi(
  `/accounts/${accountId}/pages/projects/${projectName}/deployments?per_page=10`
);
const list = Array.isArray(deployments?.result) ? deployments.result : [];
result.deployment_count = list.length;
result.deployments = list.map((d) => ({
  id: d.id,
  short_id: d.short_id,
  created_on: d.created_on,
  modified_on: d.modified_on,
  environment: d.environment,
  url: d.url,
  source_branch: d.deployment_trigger?.metadata?.branch,
  source_commit_hash: d.deployment_trigger?.metadata?.commit_hash,
  source_commit_message: d.deployment_trigger?.metadata?.commit_message,
  is_skipped: d.is_skipped,
  latest_stage_name: d.latest_stage?.name,
  latest_stage_status: d.latest_stage?.status,
  latest_stage_started_on: d.latest_stage?.started_on,
  latest_stage_ended_on: d.latest_stage?.ended_on,
  stages: (d.stages ?? []).map((s) => ({
    name: s.name,
    status: s.status,
    started_on: s.started_on,
    ended_on: s.ended_on,
  })),
}));

if (list[0]?.id) {
  const detail = await cfApi(
    `/accounts/${accountId}/pages/projects/${projectName}/deployments/${list[0].id}`
  );
  if (detail?.result) {
    result.latest_deployment_detail = {
      id: detail.result.id,
      url: detail.result.url,
      build_image_major_version: detail.result.build_image_major_version,
      env_vars_keys: Object.keys(detail.result.env_vars ?? {}),
      stages: detail.result.stages,
      latest_stage: detail.result.latest_stage,
      build_config: detail.result.build_config,
      source: detail.result.source,
      deployment_trigger: detail.result.deployment_trigger,
      is_skipped: detail.result.is_skipped,
      project_name: detail.result.project_name,
      kv_namespaces: Object.keys(detail.result.kv_namespaces ?? {}),
    };
  }

  const logs = await cfApi(
    `/accounts/${accountId}/pages/projects/${projectName}/deployments/${list[0].id}/history/logs`
  );
  result.latest_deployment_logs_total = logs?.result?.total ?? null;
  result.latest_deployment_logs = (logs?.result?.data ?? []).slice(-200).map((entry) => ({
    ts: entry.ts,
    line: entry.line,
  }));
}

console.log("=== Cloudflare Pages Inspection ===");
console.log(JSON.stringify(result, null, 2));

async function cfApi(path) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`HTTP ${res.status} ${path}: ${body}`);
    return { errors: [{ http_status: res.status, body }] };
  }
  return res.json();
}

function mustGetEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}
