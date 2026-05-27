/**
 * Infra dashboard Edge reads (HEL infra PR #4).
 *
 * Mounted under /api/admin-console/infra/edge. Returns a bundle for the
 * InfraEdge page covering:
 *   - Cloudflare Pages projects + per-project deployment history
 *   - Sentry per-project rollup (24h unresolved, top issues)
 *   - GitHub Actions runs for a pinned set of workflows
 *
 * All reads are gated upstream by requirePlatformAdmin + write an audit
 * row per page load. Rollback / retry / rerun mutations land in PR #7.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../../middleware/asyncHandler";
import { recordAdminAction } from "../auditLog";
import { extractAuditContext, type PlatformAdminRequest } from "../types";
import {
  getConfiguredCloudflareProjects,
  listProjectViews,
  type CFPagesProjectView,
} from "./clients/cloudflareClient";
import {
  getConfiguredSentryProjects,
  listProjectRollups,
  type SentryProjectRollup,
} from "./clients/sentryClient";
import {
  getPinnedWorkflows,
  listPinnedWorkflowRuns,
  type WorkflowRunsView,
} from "./clients/githubActionsClient";

async function safeCloudflare(): Promise<{
  projects: CFPagesProjectView[];
  configured: boolean;
}> {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    return { projects: [], configured: false };
  }
  try {
    const projects = await listProjectViews(getConfiguredCloudflareProjects());
    return { projects, configured: true };
  } catch (err) {
    return {
      projects: getConfiguredCloudflareProjects().map((name) => ({
        project_name: name,
        available: false,
        deployments: [],
        error: err instanceof Error ? err.message : String(err),
      })),
      configured: true,
    };
  }
}

async function safeSentry(): Promise<{
  rollups: SentryProjectRollup[];
  configured: boolean;
}> {
  if (!process.env.SENTRY_API_TOKEN || !process.env.SENTRY_ORG_SLUG) {
    return { rollups: [], configured: false };
  }
  try {
    const rollups = await listProjectRollups(getConfiguredSentryProjects());
    return { rollups, configured: true };
  } catch (err) {
    return {
      rollups: getConfiguredSentryProjects().map((slug) => ({
        project_slug: slug,
        available: false,
        unresolved_24h: null,
        top_issues: [],
        error: err instanceof Error ? err.message : String(err),
      })),
      configured: true,
    };
  }
}

async function safeGithub(): Promise<{
  workflows: WorkflowRunsView[];
  configured: boolean;
}> {
  if (!process.env.GITHUB_TOKEN) {
    return { workflows: [], configured: false };
  }
  try {
    const workflows = await listPinnedWorkflowRuns(getPinnedWorkflows());
    return { workflows, configured: true };
  } catch (err) {
    return {
      workflows: getPinnedWorkflows().map((file) => ({
        workflow_file: file,
        available: false,
        runs: [],
        error: err instanceof Error ? err.message : String(err),
      })),
      configured: true,
    };
  }
}

export function createEdgeRoutes(_pool: Pool): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: r.platformAdmin.userId,
        action: "view_infra_edge",
        reason: "",
        context: extractAuditContext(req),
      });

      const [cf, sentry, gh] = await Promise.all([safeCloudflare(), safeSentry(), safeGithub()]);

      res.json({
        cloudflare: cf,
        sentry,
        github_actions: gh,
      });
    }),
  );

  return router;
}
