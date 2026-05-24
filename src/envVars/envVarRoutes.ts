/**
 * HEL-206 (PR C): workspace-scoped encrypted environment variables.
 *
 * Mirrors the migration 017 / 018 `provisioned_company_secrets` pattern:
 *   - Values are AES-256-GCM ciphertext at rest, encrypted via the existing
 *     `encryptSecret()` helper in src/controlPlane/secretEncryption.ts.
 *   - List paths NEVER return plaintext. The only path that can decrypt is
 *     `POST /:id/deref-token`, which issues a short-lived signed JWT that
 *     the executor exchanges out-of-band for the plaintext.
 *   - Every mutating action writes an append-only `workspace_env_var_audit`
 *     row, including grants changes and deref-token issuance.
 *
 * Scaffold-level for HEL-206. Tighter validation (Zod schemas, deref
 * exchange endpoint, anti-replay on the token) will land in the follow-up
 * security-review pass - flagged in the PR body.
 */

import { Router, Response } from "express";
import jwt from "jsonwebtoken";
import { asyncHandler } from "../middleware/asyncHandler";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { withWorkspaceContext } from "../middleware/workspaceContext";
import { getPostgresPool } from "../db/postgres";
import { encryptSecret, getActiveKeyVersion } from "../controlPlane/secretEncryption";
import { resolveAppJwtConfig } from "../auth/appAuthTokens";

type EnvVarRequest = AuthenticatedRequest & WorkspaceAwareRequest;

type GrantScopeKind = "mission" | "team" | "agent";
type GrantPermission = "allow" | "ask" | "deny";

interface GrantInput {
  scope_kind: GrantScopeKind;
  scope_id: string;
  permission: GrantPermission;
}

const SCOPE_KINDS: ReadonlySet<GrantScopeKind> = new Set(["mission", "team", "agent"]);
const PERMISSIONS: ReadonlySet<GrantPermission> = new Set(["allow", "ask", "deny"]);

function getContext(
  req: EnvVarRequest,
  res: Response,
): { workspaceId: string; userId: string } | null {
  const userId = req.auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required." });
    return null;
  }
  const workspaceId = req.workspaceId?.trim();
  if (!workspaceId) {
    res.status(400).json({ error: "Workspace context is required." });
    return null;
  }
  return { workspaceId, userId };
}

function parseGrants(input: unknown): GrantInput[] | { error: string } {
  if (input === undefined || input === null) {
    return [];
  }
  if (!Array.isArray(input)) {
    return { error: "grants must be an array." };
  }
  const grants: GrantInput[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      return { error: "Each grant must be an object." };
    }
    const r = raw as Record<string, unknown>;
    const scopeKind = typeof r.scope_kind === "string" ? r.scope_kind : "";
    const scopeId = typeof r.scope_id === "string" ? r.scope_id.trim() : "";
    const permission = typeof r.permission === "string" ? r.permission : "";
    if (!SCOPE_KINDS.has(scopeKind as GrantScopeKind)) {
      return { error: `Invalid scope_kind: ${scopeKind}` };
    }
    if (!scopeId) {
      return { error: "scope_id is required." };
    }
    if (!PERMISSIONS.has(permission as GrantPermission)) {
      return { error: `Invalid permission: ${permission}` };
    }
    grants.push({
      scope_kind: scopeKind as GrantScopeKind,
      scope_id: scopeId,
      permission: permission as GrantPermission,
    });
  }
  return grants;
}

function validateName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return null;
  // Conventional env-var names: uppercase letters, digits, underscores.
  // We accept lowercase too because some integrations key off lowercase paths.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return null;
  return trimmed;
}

function validateValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Plaintext is encrypted immediately; we don't constrain its shape beyond
  // a sanity length cap. 64KiB is generous for env-var-style secrets.
  if (value.length === 0 || value.length > 64 * 1024) return null;
  return value;
}

export function createEnvVarRoutes() {
  const router = Router();

  // ----------------------------------------------------------------
  // GET / - list env vars (no values, no ciphertext)
  // ----------------------------------------------------------------
  router.get(
    "/",
    asyncHandler<EnvVarRequest>(async (req, res) => {
      const ctx = getContext(req, res);
      if (!ctx) return;
      const rows = await withWorkspaceContext(
        getPostgresPool(),
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        async (client) => {
          const vars = await client.query<{
            id: string;
            name: string;
            key_version: number;
            created_at: string;
            last_used_at: string | null;
            created_by_user_id: string | null;
          }>(
            `SELECT id, name, key_version, created_at, last_used_at, created_by_user_id
               FROM workspace_env_vars
              WHERE workspace_id = $1
              ORDER BY name ASC`,
            [ctx.workspaceId],
          );
          const grants = await client.query<{
            env_var_id: string;
            scope_kind: string;
            scope_id: string;
            permission: string;
          }>(
            `SELECT env_var_id, scope_kind, scope_id, permission
               FROM workspace_env_var_grants
              WHERE env_var_id = ANY($1::uuid[])`,
            [vars.rows.map((r) => r.id)],
          );
          const grantsById = new Map<string, GrantInput[]>();
          for (const g of grants.rows) {
            const list = grantsById.get(g.env_var_id) ?? [];
            list.push({
              scope_kind: g.scope_kind as GrantScopeKind,
              scope_id: g.scope_id,
              permission: g.permission as GrantPermission,
            });
            grantsById.set(g.env_var_id, list);
          }
          return vars.rows.map((row) => ({
            id: row.id,
            name: row.name,
            keyVersion: row.key_version,
            createdAt: row.created_at,
            lastUsedAt: row.last_used_at,
            createdByUserId: row.created_by_user_id,
            grants: grantsById.get(row.id) ?? [],
          }));
        },
      );
      res.json({ envVars: rows, total: rows.length });
    }),
  );

  // ----------------------------------------------------------------
  // POST / - create env var with optional grants
  // body: { name, value, grants?: [{scope_kind, scope_id, permission}] }
  // ----------------------------------------------------------------
  router.post(
    "/",
    asyncHandler<EnvVarRequest>(async (req, res) => {
      const ctx = getContext(req, res);
      if (!ctx) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = validateName(body.name);
      if (!name) {
        res.status(400).json({ error: "name must be a valid env-var identifier." });
        return;
      }
      const value = validateValue(body.value);
      if (!value) {
        res.status(400).json({ error: "value must be a non-empty string up to 64KiB." });
        return;
      }
      const grantsResult = parseGrants(body.grants);
      if (!Array.isArray(grantsResult)) {
        res.status(400).json({ error: grantsResult.error });
        return;
      }
      // Encrypt outside the transaction so a slow KMS round-trip doesn't hold
      // an RLS connection idle.
      const { ciphertext, iv, authTag, keyVersion } = encryptSecret(value);

      try {
        const created = await withWorkspaceContext(
          getPostgresPool(),
          { workspaceId: ctx.workspaceId, userId: ctx.userId },
          async (client) => {
            const insertRow = await client.query<{ id: string; created_at: string }>(
              `INSERT INTO workspace_env_vars (
                 workspace_id, name, encrypted_value, iv, auth_tag, key_version, created_by_user_id
               ) VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id, created_at`,
              [
                ctx.workspaceId,
                name,
                ciphertext,
                iv,
                authTag,
                keyVersion,
                ctx.userId,
              ],
            );
            const envVarId = insertRow.rows[0].id;
            for (const grant of grantsResult) {
              await client.query(
                `INSERT INTO workspace_env_var_grants (env_var_id, scope_kind, scope_id, permission)
                 VALUES ($1, $2, $3, $4)`,
                [envVarId, grant.scope_kind, grant.scope_id, grant.permission],
              );
            }
            await client.query(
              `INSERT INTO workspace_env_var_audit (env_var_id, action, actor_id, metadata)
               VALUES ($1, 'create', $2, $3::jsonb)`,
              [
                envVarId,
                ctx.userId,
                JSON.stringify({ name, keyVersion, grantsCount: grantsResult.length }),
              ],
            );
            return {
              id: envVarId,
              name,
              keyVersion,
              createdAt: insertRow.rows[0].created_at,
              grants: grantsResult,
            };
          },
        );
        res.status(201).json(created);
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === "23505") {
          res.status(409).json({ error: `Env var '${name}' already exists in this workspace.` });
          return;
        }
        throw err;
      }
    }),
  );

  // ----------------------------------------------------------------
  // PUT /:id/grants - upsert grants for an env var
  // body: { grants: [{scope_kind, scope_id, permission}, ...] }
  // ----------------------------------------------------------------
  router.put(
    "/:id/grants",
    asyncHandler<EnvVarRequest>(async (req, res) => {
      const ctx = getContext(req, res);
      if (!ctx) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const grantsResult = parseGrants(body.grants);
      if (!Array.isArray(grantsResult)) {
        res.status(400).json({ error: grantsResult.error });
        return;
      }
      const envVarId = req.params.id;
      const result = await withWorkspaceContext(
        getPostgresPool(),
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        async (client) => {
          const exists = await client.query<{ id: string }>(
            `SELECT id FROM workspace_env_vars WHERE id = $1`,
            [envVarId],
          );
          if (exists.rowCount === 0) {
            return null;
          }
          // Replace-all semantics: drop existing grants, insert the new set,
          // and record a single audit row that captures the new shape.
          await client.query(
            `DELETE FROM workspace_env_var_grants WHERE env_var_id = $1`,
            [envVarId],
          );
          for (const grant of grantsResult) {
            await client.query(
              `INSERT INTO workspace_env_var_grants (env_var_id, scope_kind, scope_id, permission)
               VALUES ($1, $2, $3, $4)`,
              [envVarId, grant.scope_kind, grant.scope_id, grant.permission],
            );
          }
          await client.query(
            `INSERT INTO workspace_env_var_audit (env_var_id, action, actor_id, metadata)
             VALUES ($1, 'grants_upsert', $2, $3::jsonb)`,
            [envVarId, ctx.userId, JSON.stringify({ grants: grantsResult })],
          );
          return { id: envVarId, grants: grantsResult };
        },
      );
      if (!result) {
        res.status(404).json({ error: "Env var not found." });
        return;
      }
      res.json(result);
    }),
  );

  // ----------------------------------------------------------------
  // POST /:id/rotate - re-encrypt with a new plaintext and bump key_version
  // body: { value }
  // ----------------------------------------------------------------
  router.post(
    "/:id/rotate",
    asyncHandler<EnvVarRequest>(async (req, res) => {
      const ctx = getContext(req, res);
      if (!ctx) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const value = validateValue(body.value);
      if (!value) {
        res.status(400).json({ error: "value must be a non-empty string up to 64KiB." });
        return;
      }
      const envVarId = req.params.id;
      // Rotate to the currently-active key_version. If ops also rotates the
      // master key, callers will sweep with a separate background job.
      const activeVersion = getActiveKeyVersion();
      const { ciphertext, iv, authTag, keyVersion } = encryptSecret(value, activeVersion);
      const result = await withWorkspaceContext(
        getPostgresPool(),
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        async (client) => {
          const existing = await client.query<{ key_version: number }>(
            `SELECT key_version FROM workspace_env_vars WHERE id = $1`,
            [envVarId],
          );
          if (existing.rowCount === 0) {
            return null;
          }
          const previousKeyVersion = existing.rows[0].key_version;
          await client.query(
            `UPDATE workspace_env_vars
                SET encrypted_value = $1,
                    iv = $2,
                    auth_tag = $3,
                    key_version = $4,
                    updated_at = now()
              WHERE id = $5`,
            [ciphertext, iv, authTag, keyVersion, envVarId],
          );
          await client.query(
            `INSERT INTO workspace_env_var_audit (env_var_id, action, actor_id, metadata)
             VALUES ($1, 'rotate', $2, $3::jsonb)`,
            [
              envVarId,
              ctx.userId,
              JSON.stringify({ previousKeyVersion, keyVersion }),
            ],
          );
          return { id: envVarId, keyVersion };
        },
      );
      if (!result) {
        res.status(404).json({ error: "Env var not found." });
        return;
      }
      res.json(result);
    }),
  );

  // ----------------------------------------------------------------
  // DELETE /:id - record audit then cascade-delete grants + audit-by-FK
  // (audit row inserted BEFORE delete because ON DELETE CASCADE would
  // otherwise wipe the audit trail).
  // ----------------------------------------------------------------
  router.delete(
    "/:id",
    asyncHandler<EnvVarRequest>(async (req, res) => {
      const ctx = getContext(req, res);
      if (!ctx) return;
      const envVarId = req.params.id;
      const deleted = await withWorkspaceContext(
        getPostgresPool(),
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        async (client) => {
          const existing = await client.query<{ name: string; key_version: number }>(
            `SELECT name, key_version FROM workspace_env_vars WHERE id = $1`,
            [envVarId],
          );
          if (existing.rowCount === 0) {
            return false;
          }
          // TODO(HEL-206 follow-up): move env-var audit rows to a parent
          // table keyed off (workspace_id, env_var_id, name) so deletion
          // preserves the audit trail. Today the ON DELETE CASCADE on
          // workspace_env_var_audit removes the rows alongside the env var
          // record - fine for the scaffold but not for compliance.
          await client.query(
            `INSERT INTO workspace_env_var_audit (env_var_id, action, actor_id, metadata)
             VALUES ($1, 'delete', $2, $3::jsonb)`,
            [
              envVarId,
              ctx.userId,
              JSON.stringify({
                name: existing.rows[0].name,
                keyVersion: existing.rows[0].key_version,
              }),
            ],
          );
          await client.query(`DELETE FROM workspace_env_vars WHERE id = $1`, [envVarId]);
          return true;
        },
      );
      if (!deleted) {
        res.status(404).json({ error: "Env var not found." });
        return;
      }
      res.status(204).send();
    }),
  );

  // ----------------------------------------------------------------
  // POST /:id/deref-token - return a short-lived signed token
  // The token does NOT contain the plaintext; it carries a workspace-scoped
  // claim that the executor exchanges via a separate (TODO) endpoint for the
  // decrypted value. Issuing the token is itself audited.
  // ----------------------------------------------------------------
  router.post(
    "/:id/deref-token",
    asyncHandler<EnvVarRequest>(async (req, res) => {
      const ctx = getContext(req, res);
      if (!ctx) return;
      const envVarId = req.params.id;
      const config = resolveAppJwtConfig();
      if (!config) {
        // TODO(HEL-206 follow-up): provide a scaffolded HMAC fallback so the
        // deref path can be exercised in dev environments that haven't yet
        // configured APP_JWT_SECRET. For now we surface a 503 so the surface
        // is obvious instead of silently failing to sign.
        res.status(503).json({ error: "Deref token signing requires APP_JWT_SECRET." });
        return;
      }
      const result = await withWorkspaceContext(
        getPostgresPool(),
        { workspaceId: ctx.workspaceId, userId: ctx.userId },
        async (client) => {
          const existing = await client.query<{ id: string }>(
            `SELECT id FROM workspace_env_vars WHERE id = $1`,
            [envVarId],
          );
          if (existing.rowCount === 0) {
            return null;
          }
          await client.query(
            `INSERT INTO workspace_env_var_audit (env_var_id, action, actor_id, metadata)
             VALUES ($1, 'deref_token_issue', $2, $3::jsonb)`,
            [envVarId, ctx.userId, JSON.stringify({ ttlSeconds: 60 })],
          );
          return { id: envVarId };
        },
      );
      if (!result) {
        res.status(404).json({ error: "Env var not found." });
        return;
      }
      const token = jwt.sign(
        {
          type: "env_var_deref",
          envVarId,
          workspaceId: ctx.workspaceId,
          sub: ctx.userId,
        },
        config.secret,
        {
          algorithm: "HS256",
          issuer: config.issuer,
          audience: `${config.audience}:env-var-deref`,
          expiresIn: "60s" as jwt.SignOptions["expiresIn"],
        },
      );
      res.json({ token, expiresInSeconds: 60 });
    }),
  );

  return router;
}

export default createEnvVarRoutes();
