import { Router } from "express";
import { randomBytes } from "crypto";
import type { Pool, PoolClient } from "pg";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { grantCredits } from "../billing/credits/walletStore";
import { provisionDefaultWorkspace } from "../middleware/workspaceResolver";
import { asyncHandler } from "../middleware/asyncHandler";
import { fileObjectStore } from "../storage/fileObjectStore";
import { enqueueObjectDeletion } from "../queue/storageQueue";

const DEFAULT_SIGNUP_TRIAL_CREDITS = 10000n;

/**
 * Free credits granted to a new workspace on creation. Idempotent on
 * workspace_id so re-running the signup flow (or any future replay)
 * never double-grants. Configurable via `SIGNUP_TRIAL_CREDITS` env var;
 * default is 10,000 credits ≈ $1 wholesale, ≈ $1.50 retail — enough
 * for a customer to evaluate hosted-credits mode without paying first.
 *
 * Setting `SIGNUP_TRIAL_CREDITS=0` disables the grant entirely.
 */
function readSignupTrialCredits(): bigint {
  const raw = process.env.SIGNUP_TRIAL_CREDITS?.trim();
  if (!raw) return DEFAULT_SIGNUP_TRIAL_CREDITS;
  try {
    const parsed = BigInt(raw);
    return parsed >= 0n ? parsed : DEFAULT_SIGNUP_TRIAL_CREDITS;
  } catch {
    return DEFAULT_SIGNUP_TRIAL_CREDITS;
  }
}

async function grantSignupTrialCredits(workspaceId: string, userId: string): Promise<void> {
  const credits = readSignupTrialCredits();
  if (credits <= 0n) return;
  try {
    const result = await grantCredits({
      workspaceId,
      userId,
      credits,
      grantType: "grant",
      idempotencyKey: `signup_trial__${workspaceId}`,
      relatedKind: "workspace_signup",
      relatedId: workspaceId,
      metadata: { source: "signup_trial", granted_via: "workspace_create" },
    });
    if (result.reason === "granted") {
      console.log(
        `[workspaces] granted ${credits.toString()} signup-trial credits to workspace ${workspaceId}`,
      );
    }
  } catch (err) {
    // Best-effort — never fail workspace creation because of a grant
    // error. The customer can still buy credits or use BYOK.
    console.error(
      `[workspaces] signup-trial grant failed for workspace ${workspaceId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

type WorkspaceRow = {
  id: string;
  name: string;
};

type CreateWorkspaceRow = WorkspaceRow;

function slugifyWorkspaceName(value: string, fallbackId: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallbackId.toLowerCase();
}

export function createWorkspaceRoutes(pool: Pool) {
  const router = Router();

  router.get("/", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub?.trim();
    if (!userId) {
      res.status(401).json({ error: "Authenticated user required" });
      return;
    }

    const listQuery = `SELECT DISTINCT w.id, w.name
         FROM workspaces w
         LEFT JOIN workspace_members wm
           ON wm.workspace_id = w.id
        WHERE w.owner_user_id = $1
           OR wm.user_id = $1
        ORDER BY w.name ASC, w.id ASC`;

    let result = await pool.query<WorkspaceRow>(listQuery, [userId]);

    // If the user has zero workspaces, lazy-provision a default one and
    // re-query. Keeps the dashboard's WorkspaceContext bootstrap consistent
    // with the workspaceResolver middleware (which also auto-provisions on
    // first authenticated request). Without this, a freshly-signed-up user
    // sees an empty workspace list and the dashboard stays in the "no
    // workspaces" UI even though backend API calls would auto-create one.
    if (result.rows.length === 0) {
      try {
        await provisionDefaultWorkspace(pool, userId);
        result = await pool.query<WorkspaceRow>(listQuery, [userId]);
      } catch (err) {
        console.error("[workspaces] Auto-provision on list failed:", (err as Error).message);
        // Fall through — return the empty list rather than 500ing. The
        // resolver middleware will retry on the next API call.
      }
    }

    const workspaces = result.rows.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      slug: slugifyWorkspaceName(workspace.name, workspace.id),
    }));

    res.json(workspaces);
  }));

  router.post("/", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub?.trim();
    if (!userId) {
      res.status(401).json({ error: "Authenticated user required" });
      return;
    }

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "name is required and must be a non-empty string" });
      return;
    }

    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const outboundSecret = randomBytes(32).toString("hex");
      const insertedWorkspace = await client.query<CreateWorkspaceRow>(
        `INSERT INTO workspaces (name, owner_user_id, outbound_webhook_secret)
         VALUES ($1, $2, $3)
         RETURNING id, name`,
        [name, userId, outboundSecret],
      );
      const workspace = insertedWorkspace.rows[0];
      if (!workspace) {
        throw new Error("workspace_create_failed");
      }

      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [workspace.id, userId],
      );

      await client.query("COMMIT");

      // HEL-credits-mvp follow-up: grant signup-trial credits so the
      // workspace can try hosted-credits mode immediately. Best-effort —
      // the COMMIT above is the source of truth for workspace existence;
      // a grant failure shouldn't block the response.
      await grantSignupTrialCredits(workspace.id, userId);

      res.status(201).json({
        id: workspace.id,
        name: workspace.name,
        slug: slugifyWorkspaceName(workspace.name, workspace.id),
      });
    } catch (error) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original creation error.
        }
      }
      console.error("[workspaces] Failed to create workspace:", (error as Error).message);
      res.status(500).json({ error: "Failed to create workspace" });
    } finally {
      client?.release();
    }
  }));

  // -------------------------------------------------------------------
  // PATCH /api/workspaces/:id — rename a workspace (HEL-192)
  //
  // Auth: only `owner` or `admin` members of the target workspace can
  // rename it. Other workspaces in the user's membership graph are
  // untouched. We resolve the role inline (rather than via the global
  // `workspaceResolver` middleware) because this route doesn't operate
  // on the user's "active" workspace — the path param picks the
  // workspace to mutate.
  // -------------------------------------------------------------------
  router.patch("/:id", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub?.trim();
    if (!userId) {
      res.status(401).json({ error: "Authenticated user required" });
      return;
    }

    const workspaceId = req.params.id;
    if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) {
      res.status(400).json({ error: "Invalid workspace ID format" });
      return;
    }

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "name is required and must be a non-empty string" });
      return;
    }

    try {
      // Membership + role check in one query. Treat workspace owner as
      // implicit admin so OAuth-only users (who skip explicit member
      // rows) can still rename their own workspace.
      const roleResult = await pool.query<{ role: string }>(
        `SELECT CASE
                  WHEN w.owner_user_id = $2 THEN 'owner'
                  ELSE wm.role
                END AS role
           FROM workspaces w
           LEFT JOIN workspace_members wm
             ON wm.workspace_id = w.id AND wm.user_id = $2
          WHERE w.id = $1
          LIMIT 1`,
        [workspaceId, userId],
      );

      if (roleResult.rows.length === 0) {
        res.status(404).json({ error: "Workspace not found" });
        return;
      }
      const role = roleResult.rows[0].role;
      if (role !== "owner" && role !== "admin") {
        res.status(403).json({ error: "Only workspace owners or admins can rename a workspace" });
        return;
      }

      const updated = await pool.query<WorkspaceRow>(
        `UPDATE workspaces SET name = $1 WHERE id = $2 RETURNING id, name`,
        [name, workspaceId],
      );
      const workspace = updated.rows[0];
      if (!workspace) {
        res.status(404).json({ error: "Workspace not found" });
        return;
      }

      res.json({
        id: workspace.id,
        name: workspace.name,
        slug: slugifyWorkspaceName(workspace.name, workspace.id),
      });
    } catch (error) {
      console.error("[workspaces] Failed to patch workspace:", (error as Error).message);
      res.status(500).json({ error: "Failed to update workspace" });
    }
  }));

  // -------------------------------------------------------------------
  // DELETE /api/workspaces/:id — permanently delete a workspace (HEL-356)
  //
  // OWNER-ONLY, destructive, irreversible. Requires a typed confirmation
  // (body.confirm must equal the workspace name) and refuses while a paid
  // subscription is active. Queues object-storage cleanup for every
  // file_objects row BEFORE the workspace DELETE, whose ON DELETE CASCADE
  // FKs then remove all child rows (file_objects, companies, missions,
  // runs, …).
  // -------------------------------------------------------------------
  router.delete("/:id", asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const userId = req.auth?.sub?.trim();
    if (!userId) {
      res.status(401).json({ error: "Authenticated user required" });
      return;
    }

    const workspaceId = req.params.id;
    if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) {
      res.status(400).json({ error: "Invalid workspace ID format" });
      return;
    }

    try {
      // Owner-only. Opaque 404 — never leak the existence of another user's
      // workspace.
      const wsResult = await pool.query<{ name: string; owner_user_id: string }>(
        `SELECT name, owner_user_id FROM workspaces WHERE id = $1 LIMIT 1`,
        [workspaceId],
      );
      const workspace = wsResult.rows[0];
      if (!workspace || workspace.owner_user_id !== userId) {
        res.status(404).json({ error: "Workspace not found" });
        return;
      }

      // Typed confirmation — guards against accidental deletion.
      const confirm = typeof req.body?.confirm === "string" ? req.body.confirm : "";
      if (confirm !== workspace.name) {
        res.status(400).json({
          error: 'Confirmation required: send { confirm: "<workspace name>" } matching the workspace name.',
          code: "confirmation_required",
        });
        return;
      }

      // Refuse while billing is active — deletion would orphan the Stripe
      // subscription. (Programmatic cancellation is a separate concern.)
      const subResult = await pool.query(
        `SELECT 1 FROM subscriptions
          WHERE workspace_id = $1 AND status IN ('active', 'trialing', 'past_due')
          LIMIT 1`,
        [workspaceId],
      );
      if (subResult.rows.length > 0) {
        res.status(409).json({
          error: "Cancel the workspace's billing subscription before deleting it.",
          code: "active_subscription",
        });
        return;
      }

      // Queue object-storage cleanup for every stored file BEFORE the cascade
      // removes the file_objects rows (each job carries the storage key).
      let fileObjectsQueued = 0;
      try {
        const files = await fileObjectStore.listByWorkspace({ workspaceId, userId });
        for (const file of files) {
          await enqueueObjectDeletion({
            workspaceId,
            fileId: file.id,
            storageKey: file.storageKey,
            provider: file.provider,
            bucket: file.bucket,
          });
          fileObjectsQueued += 1;
        }
      } catch (err) {
        // Best-effort: a cleanup-enqueue failure must not block deletion, but
        // log loudly — objects may linger until a reconciliation sweep.
        console.error(
          `[workspaces] storage cleanup enqueue failed for workspace ${workspaceId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }

      const deleted = await pool.query(
        `DELETE FROM workspaces WHERE id = $1 AND owner_user_id = $2`,
        [workspaceId, userId],
      );
      if ((deleted.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "Workspace not found" });
        return;
      }

      console.log(
        `[workspaces] workspace ${workspaceId} deleted by ${userId}; queued ${fileObjectsQueued} object(s) for storage cleanup`,
      );
      res.json({ deleted: true, fileObjectsQueued });
    } catch (error) {
      console.error("[workspaces] Failed to delete workspace:", (error as Error).message);
      res.status(500).json({ error: "Failed to delete workspace" });
    }
  }));

  return router;
}
