#!/usr/bin/env node

const accountId = mustGetEnv("CLOUDFLARE_ACCOUNT_ID");
const apiToken = mustGetEnv("CLOUDFLARE_API_TOKEN");
const repoOwner = mustGetEnv("GITHUB_REPOSITORY_OWNER");
const repoName = mustGetEnv("GITHUB_REPOSITORY_NAME");
const repoId = String(mustGetEnv("GITHUB_REPOSITORY_ID"));
const projectFilter = parseCsv(process.env.CF_PAGES_PROJECTS);
const applyDomains = parseBool(process.env.CF_PAGES_APPLY_DOMAINS, true);
const retireLegacy = parseBool(process.env.CF_PAGES_RETIRE_LEGACY, false);

const configs = [
  {
    key: "dashboard",
    projectName: "autoflow-dashboard-git",
    legacyProjectName: "autoflow-dashboard",
    productionBranch: "master",
    buildConfig: {
      build_command: "npm ci && npm run build",
      destination_dir: "dist",
      root_dir: "dashboard",
    },
    customDomains: ["app.helloautoflow.com"],
    sourceConfig: {
      path_includes: [
        "dashboard/**",
        "infra/scripts/cloudflare-pages-sync.mjs",
        ".github/workflows/cloudflare-pages-migrate.yml",
      ],
      preview_deployment_setting: "all",
      production_deployments_enabled: true,
    },
    previewEnv: {
      BACKEND_API_BASE_URL: plain("https://staging-api.helloautoflow.com"),
      BILLING_API_BASE_URL: plain("https://staging-api.helloautoflow.com"),
      VITE_API_BASE_URL: plain("https://staging-api.helloautoflow.com"),
      VITE_API_URL: plain("https://staging-api.helloautoflow.com"),
      VITE_USE_MOCK: plain("false"),
      VITE_AZURE_CIAM_TENANT_SUBDOMAIN: secret(envOrEmpty("CF_PAGES_AZURE_TENANT_SUBDOMAIN")),
      AZURE_CIAM_TENANT_SUBDOMAIN: secret(envOrEmpty("CF_PAGES_AZURE_TENANT_SUBDOMAIN")),
      AZURE_TENANT_SUBDOMAIN: secret(envOrEmpty("CF_PAGES_AZURE_TENANT_SUBDOMAIN")),
      AZURE_CIAM_TENANT_ID: plain(envOrEmpty("CF_PAGES_AZURE_TENANT_ID")),
      AZURE_TENANT_ID: plain(envOrEmpty("CF_PAGES_AZURE_TENANT_ID")),
      APP_JWT_SECRET: secret(envOrEmpty("CF_PAGES_APP_JWT_SECRET")),
      QA_PREVIEW_ACCESS_TOKEN: secret(envOrEmpty("CF_PAGES_QA_PREVIEW_ACCESS_TOKEN")),
    },
    productionEnv: {
      BACKEND_API_BASE_URL: plain("https://api.helloautoflow.com"),
      BILLING_API_BASE_URL: plain("https://api.helloautoflow.com"),
      VITE_API_BASE_URL: plain("https://api.helloautoflow.com"),
      VITE_API_URL: plain("https://api.helloautoflow.com"),
      VITE_USE_MOCK: plain("false"),
      VITE_AZURE_CIAM_TENANT_SUBDOMAIN: secret(envOrEmpty("CF_PAGES_AZURE_TENANT_SUBDOMAIN")),
      AZURE_CIAM_TENANT_SUBDOMAIN: secret(envOrEmpty("CF_PAGES_AZURE_TENANT_SUBDOMAIN")),
      AZURE_TENANT_SUBDOMAIN: secret(envOrEmpty("CF_PAGES_AZURE_TENANT_SUBDOMAIN")),
      AZURE_CIAM_TENANT_ID: plain(envOrEmpty("CF_PAGES_AZURE_TENANT_ID")),
      AZURE_TENANT_ID: plain(envOrEmpty("CF_PAGES_AZURE_TENANT_ID")),
    },
  },
  {
    key: "staging",
    projectName: "autoflow-staging-git",
    legacyProjectName: "autoflow-staging",
    productionBranch: "staging",
    buildConfig: {
      build_command: "npm ci && npm run build",
      destination_dir: "dist",
      root_dir: "dashboard",
    },
    customDomains: ["staging.app.helloautoflow.com"],
    sourceConfig: {
      path_includes: [
        "dashboard/**",
        "infra/scripts/cloudflare-pages-sync.mjs",
        ".github/workflows/cloudflare-pages-migrate.yml",
      ],
      preview_deployment_setting: "none",
      production_deployments_enabled: true,
    },
    previewEnv: {
      BACKEND_API_BASE_URL: plain("https://staging-api.helloautoflow.com"),
      BILLING_API_BASE_URL: plain("https://staging-api.helloautoflow.com"),
      VITE_API_BASE_URL: plain("https://staging-api.helloautoflow.com"),
      VITE_API_URL: plain("https://staging-api.helloautoflow.com"),
      VITE_USE_MOCK: plain("false"),
      VITE_AZURE_CIAM_TENANT_SUBDOMAIN: secret(envOrEmpty("CF_PAGES_AZURE_TENANT_SUBDOMAIN")),
      AZURE_CIAM_TENANT_SUBDOMAIN: secret(envOrEmpty("CF_PAGES_AZURE_TENANT_SUBDOMAIN")),
      AZURE_TENANT_SUBDOMAIN: secret(envOrEmpty("CF_PAGES_AZURE_TENANT_SUBDOMAIN")),
      AZURE_CIAM_TENANT_ID: plain(envOrEmpty("CF_PAGES_AZURE_TENANT_ID")),
      AZURE_TENANT_ID: plain(envOrEmpty("CF_PAGES_AZURE_TENANT_ID")),
      APP_JWT_SECRET: secret(envOrEmpty("CF_PAGES_APP_JWT_SECRET")),
      QA_PREVIEW_ACCESS_TOKEN: secret(envOrEmpty("CF_PAGES_QA_PREVIEW_ACCESS_TOKEN")),
    },
    productionEnv: {
      BACKEND_API_BASE_URL: plain("https://staging-api.helloautoflow.com"),
      BILLING_API_BASE_URL: plain("https://staging-api.helloautoflow.com"),
      VITE_API_BASE_URL: plain("https://staging-api.helloautoflow.com"),
      VITE_API_URL: plain("https://staging-api.helloautoflow.com"),
      VITE_USE_MOCK: plain("false"),
      VITE_AZURE_CIAM_TENANT_SUBDOMAIN: secret(envOrEmpty("CF_PAGES_AZURE_TENANT_SUBDOMAIN")),
      AZURE_CIAM_TENANT_SUBDOMAIN: secret(envOrEmpty("CF_PAGES_AZURE_TENANT_SUBDOMAIN")),
      AZURE_TENANT_SUBDOMAIN: secret(envOrEmpty("CF_PAGES_AZURE_TENANT_SUBDOMAIN")),
      AZURE_CIAM_TENANT_ID: plain(envOrEmpty("CF_PAGES_AZURE_TENANT_ID")),
      AZURE_TENANT_ID: plain(envOrEmpty("CF_PAGES_AZURE_TENANT_ID")),
    },
  },
  {
    key: "docs",
    projectName: "autoflow-docs-git",
    legacyProjectName: "autoflow-docs",
    productionBranch: "staging",
    buildConfig: {
      build_command: "npm ci && npm run build",
      destination_dir: "build/client",
      root_dir: "docs",
    },
    customDomains: ["docs.helloautoflow.com"],
    sourceConfig: {
      path_includes: [
        "docs/**",
        "infra/scripts/cloudflare-pages-sync.mjs",
        ".github/workflows/cloudflare-pages-migrate.yml",
      ],
      preview_deployment_setting: "all",
      production_deployments_enabled: true,
    },
    previewEnv: {},
    productionEnv: {},
  },
  {
    key: "landing",
    unsupportedReason:
      "landing/ contains live Next.js server routes under app/api and cannot be migrated to a static Cloudflare Pages Git build without app replatforming.",
  },
];

const selectedConfigs = configs.filter((config) => {
  if (projectFilter.length === 0) return true;
  return projectFilter.includes(config.key);
});

const summary = {
  applied: [],
  skipped: [],
  unsupported: [],
};

for (const config of selectedConfigs) {
  if (config.unsupportedReason) {
    summary.unsupported.push(`${config.key}: ${config.unsupportedReason}`);
    console.log(`::warning::Skipping ${config.key}: ${config.unsupportedReason}`);
    continue;
  }

  console.log(`\n=== Syncing ${config.key} (${config.projectName}) ===`);

  const payload = {
    name: config.projectName,
    production_branch: config.productionBranch,
    build_config: config.buildConfig,
    deployment_configs: {
      preview: {
        env_vars: compactEnvVars(config.previewEnv),
      },
      production: {
        env_vars: compactEnvVars(config.productionEnv),
      },
    },
    source: {
      type: "github",
      config: {
        owner: repoOwner,
        preview_deployment_setting: config.sourceConfig.preview_deployment_setting,
        production_branch: config.productionBranch,
        production_deployments_enabled: config.sourceConfig.production_deployments_enabled,
        repo_id: repoId,
        repo_name: repoName,
        path_includes: config.sourceConfig.path_includes,
      },
    },
  };

  const existing = await getProject(config.projectName);
  if (existing) {
    await cfApi(`/accounts/${accountId}/pages/projects/${config.projectName}`, {
      body: JSON.stringify(payload),
      method: "PATCH",
    });
    console.log(`Updated project ${config.projectName}`);
  } else {
    await cfApi(`/accounts/${accountId}/pages/projects`, {
      body: JSON.stringify(payload),
      method: "POST",
    });
    console.log(`Created project ${config.projectName}`);
  }

  const deployment = await ensureDeploymentStarted(config.projectName, config.productionBranch);
  await waitForSuccessfulDeployment(config.projectName, deployment?.id ?? null);

  if (applyDomains) {
    await syncDomains(config);
  }

  summary.applied.push(config.key);
}

console.log("\n=== Summary ===");
console.log(JSON.stringify(summary, null, 2));

async function syncDomains(config) {
  if (config.legacyProjectName && config.legacyProjectName !== config.projectName) {
    const legacyProject = await getProject(config.legacyProjectName);
    if (legacyProject) {
      const legacyDomains = await listDomains(config.legacyProjectName);
      for (const domain of config.customDomains) {
        if (legacyDomains.some((entry) => entry.name === domain)) {
          await cfApi(
            `/accounts/${accountId}/pages/projects/${config.legacyProjectName}/domains/${encodeURIComponent(domain)}`,
            { method: "DELETE" }
          );
          console.log(`Detached ${domain} from legacy project ${config.legacyProjectName}`);
        }
      }
    }
  }

  const currentDomains = await listDomains(config.projectName);
  for (const domain of config.customDomains) {
    if (!currentDomains.some((entry) => entry.name === domain)) {
      await cfApi(`/accounts/${accountId}/pages/projects/${config.projectName}/domains`, {
        body: JSON.stringify({ name: domain }),
        method: "POST",
      });
      console.log(`Attached ${domain} to ${config.projectName}`);
    } else {
      console.log(`Domain ${domain} already attached to ${config.projectName}`);
    }

    await cfApi(
      `/accounts/${accountId}/pages/projects/${config.projectName}/domains/${encodeURIComponent(domain)}`,
      { method: "PATCH" }
    );
  }

  if (retireLegacy && config.legacyProjectName && config.legacyProjectName !== config.projectName) {
    const legacyProject = await getProject(config.legacyProjectName);
    if (legacyProject) {
      await cfApi(`/accounts/${accountId}/pages/projects/${config.legacyProjectName}`, {
        method: "DELETE",
      });
      console.log(`Retired legacy project ${config.legacyProjectName}`);
    }
  }
}

async function ensureDeploymentStarted(projectName, branch) {
  const deployment = await getLatestDeployment(projectName);
  if (deployment) {
    console.log(
      `Found existing deployment for ${projectName}: ${deployment.id ?? deployment.url ?? "unknown id"}`
    );
    return deployment;
  }

  console.log(`No deployments found for ${projectName}; triggering initial deployment from ${branch}`);
  return await triggerDeployment(projectName, branch);
}

async function triggerDeployment(projectName, branch) {
  const body = new FormData();
  body.set("branch", branch);

  const result = await cfApi(`/accounts/${accountId}/pages/projects/${projectName}/deployments`, {
    body,
    method: "POST",
  });
  return result?.result ?? null;
}

async function waitForSuccessfulDeployment(projectName, expectedDeploymentId = null) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const deployment = await getLatestDeployment(projectName);

    if (expectedDeploymentId && deployment?.id && deployment.id !== expectedDeploymentId) {
      console.log(
        `Latest deployment for ${projectName} is ${deployment.id}; waiting for ${expectedDeploymentId}... (${attempt}/30)`
      );
      await sleep(10000);
      continue;
    }

    const status = deploymentStatus(deployment);
    if (status === "success") {
      console.log(
        `Latest deployment for ${projectName} succeeded: ${deployment?.url ?? "no deployment url"}`
      );
      return;
    }
    if (status === "failure") {
      throw new Error(
        `Latest deployment for ${projectName} failed: ${JSON.stringify(deployment?.latest_stage ?? deployment?.stages ?? deployment)}`
      );
    }

    console.log(`Deployment for ${projectName} is ${status ?? "pending"}; waiting... (${attempt}/30)`);
    await sleep(10000);
  }

  throw new Error(`Timed out waiting for ${projectName} deployment to succeed.`);
}

function deploymentStatus(deployment) {
  if (!deployment) return null;
  const stages = Array.isArray(deployment.stages) ? deployment.stages : [];
  const deployStage = stages.find((stage) => stage.name === "deploy");
  return deployStage?.status ?? stages[stages.length - 1]?.status ?? null;
}

async function listDomains(projectName) {
  const result = await cfApi(
    `/accounts/${accountId}/pages/projects/${projectName}/domains`,
    { method: "GET" }
  );
  return Array.isArray(result.result) ? result.result : [];
}

async function getLatestDeployment(projectName) {
  const result = await cfApi(
    `/accounts/${accountId}/pages/projects/${projectName}/deployments?per_page=1`,
    { method: "GET" }
  );
  return Array.isArray(result.result) ? result.result[0] ?? null : null;
}

async function getProject(projectName) {
  const result = await cfApi(`/accounts/${accountId}/pages/projects/${projectName}`, {
    allow404: true,
    method: "GET",
  });
  return result?.result ?? null;
}

async function cfApi(path, options) {
  const headers = {
    Authorization: `Bearer ${apiToken}`,
  };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: options.method,
    headers,
    body: options.body,
  });

  if (options.allow404 && response.status === 404) {
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(
      `Cloudflare API ${options.method} ${path} failed: ${JSON.stringify(payload.errors ?? payload)}`
    );
  }

  return payload;
}

function compactEnvVars(entries) {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value && value.value)
  );
}

function plain(value) {
  return value ? { type: "plain_text", value } : null;
}

function secret(value) {
  return value ? { type: "secret_text", value } : null;
}

function envOrEmpty(name) {
  return process.env[name]?.trim() ?? "";
}

function parseCsv(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBool(value, fallback) {
  if (value == null || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function mustGetEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
