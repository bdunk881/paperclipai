/**
 * HEL-250 — admin CRUD + observability for `platform_provider_keys`, the
 * platform-owned pool of provider API keys that fund credit-mode customer
 * calls. Mounted at /api/admin-console/credits/key-sources.
 *
 * Every route writes to platform_admin_audit_log BEFORE the side effect (the
 * audit chokepoint pattern from src/adminConsole/auditLog.ts). The ciphertext
 * is never returned over the wire — the table view shows metadata only.
 *
 * Per HEL-250 scope, ops actions:
 *   GET    /                 list with watchdog readings
 *   POST   /                 create + encrypt apiKey via connectorSecretVault
 *   PATCH  /:id              update priority/daily_spend_cap_usd/label/status
 *   POST   /:id/rotate       swap ciphertext atomically, force balance refresh
 *   POST   /:id/disable      idempotent status='disabled'
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../middleware/asyncHandler";
import { recordAdminAction } from "./auditLog";
import { consumeRateLimit } from "./rateLimit";
import { extractAuditContext, type PlatformAdminRequest } from "./types";
import {
  insertKeySource,
  listKeySources,
  rotateKeySourceCiphertext,
  setStatus,
  updateKeySourceMeta,
  type KeySourceKind,
  type KeySourceStatus,
} from "../billing/credits/keySourceStore";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_KINDS = new Set<KeySourceKind>(["openrouter", "direct"]);
// PATCH /status restricts to operator-controllable values. Throttled / low_balance
// are runtime-set by the watchdog and recordSuccess paths — admins shouldn't
// flip them by hand (the watchdog will fight them).
const PATCHABLE_STATUSES = new Set<KeySourceStatus>(["active", "disabled", "retired"]);
const MAX_LABEL = 64;
const MIN_API_KEY = 8;
const MAX_API_KEY = 512;

function tail(secret: string): string {
  return secret.length >= 4 ? `****${secret.slice(-4)}` : "****";
}

export function createCreditsPoolRoutes(_pool: Pool): Router {
  const router = Router();

  // GET /  — list every key source. Metadata only; never returns ciphertext.
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "list_provider_keys",
        context: extractAuditContext(req),
      });

      const rows = await listKeySources();
      return res.json({ rows });
    }),
  );

  // POST /  — create new key source.
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const sourceKind = String(req.body?.source_kind ?? "").trim();
      const provider = String(req.body?.provider ?? "").trim();
      const label = String(req.body?.label ?? "").trim();
      const apiKey = String(req.body?.api_key ?? "").trim();
      const priorityRaw = req.body?.priority;
      const dailyCapRaw = req.body?.daily_spend_cap_usd;
      const reason = String(req.body?.reason ?? "").trim();

      if (!VALID_KINDS.has(sourceKind as KeySourceKind)) {
        return res.status(400).json({ error: "source_kind must be 'openrouter' or 'direct'" });
      }
      if (!provider || provider.length > 64) {
        return res.status(400).json({ error: "provider required (≤64 chars)" });
      }
      if (sourceKind === "openrouter" && provider !== "openrouter") {
        // Mirrors the CHECK in migration 069 — keep the API error friendlier
        // than the raw constraint violation the DB would otherwise return.
        return res.status(400).json({ error: "openrouter source_kind requires provider='openrouter'" });
      }
      if (!label || label.length > MAX_LABEL) {
        return res.status(400).json({ error: `label required (≤${MAX_LABEL} chars)` });
      }
      if (apiKey.length < MIN_API_KEY || apiKey.length > MAX_API_KEY) {
        return res.status(400).json({ error: "api_key length out of bounds" });
      }
      const priority = priorityRaw != null ? Number(priorityRaw) : undefined;
      if (priority !== undefined && (!Number.isInteger(priority) || priority < 0 || priority > 1000)) {
        return res.status(400).json({ error: "priority must be an integer in [0, 1000]" });
      }
      const dailyCap = dailyCapRaw != null && dailyCapRaw !== "" ? Number(dailyCapRaw) : undefined;
      if (dailyCap !== undefined && (!Number.isFinite(dailyCap) || dailyCap < 0)) {
        return res.status(400).json({ error: "daily_spend_cap_usd must be a non-negative number" });
      }
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      // Audit BEFORE side-effect. Includes the masked tail (not the secret)
      // so the audit log shows which key was added without leaking it.
      await recordAdminAction(client, {
        adminUserId: admin,
        action: "create_provider_key",
        reason,
        payload: { source_kind: sourceKind, provider, label, priority, daily_spend_cap_usd: dailyCap ?? null, api_key_tail: tail(apiKey) },
        context: extractAuditContext(req),
      });

      const id = await insertKeySource({
        sourceKind: sourceKind as KeySourceKind,
        provider,
        label,
        apiKey,
        priority,
        dailySpendCapUsd: dailyCap,
      });

      return res.status(201).json({ id, masked_key: tail(apiKey) });
    }),
  );

  // PATCH /:id  — update non-secret fields.
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "reason required" });

      const patch: Record<string, unknown> = {};
      if (req.body?.priority !== undefined) {
        const p = Number(req.body.priority);
        if (!Number.isInteger(p) || p < 0 || p > 1000) {
          return res.status(400).json({ error: "priority must be an integer in [0, 1000]" });
        }
        patch.priority = p;
      }
      if (req.body?.daily_spend_cap_usd !== undefined) {
        const cap = req.body.daily_spend_cap_usd;
        if (cap === null) {
          patch.dailySpendCapUsd = null;
        } else {
          const n = Number(cap);
          if (!Number.isFinite(n) || n < 0) {
            return res.status(400).json({ error: "daily_spend_cap_usd must be a non-negative number or null" });
          }
          patch.dailySpendCapUsd = n;
        }
      }
      if (req.body?.label !== undefined) {
        const label = String(req.body.label).trim();
        if (!label || label.length > MAX_LABEL) {
          return res.status(400).json({ error: `label must be non-empty and ≤${MAX_LABEL} chars` });
        }
        patch.label = label;
      }
      const statusRaw = req.body?.status;
      const newStatus = typeof statusRaw === "string" && statusRaw.trim() ? (statusRaw.trim() as KeySourceStatus) : undefined;
      if (newStatus !== undefined && !PATCHABLE_STATUSES.has(newStatus)) {
        return res
          .status(400)
          .json({ error: "status must be one of: active, disabled, retired (throttled/low_balance are runtime-managed)" });
      }

      if (
        patch.priority === undefined
        && patch.dailySpendCapUsd === undefined
        && patch.label === undefined
        && newStatus === undefined
      ) {
        return res.status(400).json({ error: "nothing to update" });
      }

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "update_provider_key",
        reason,
        payload: { id, ...patch, status: newStatus },
        context: extractAuditContext(req),
      });

      let updated = false;
      if (
        patch.priority !== undefined
        || patch.dailySpendCapUsd !== undefined
        || patch.label !== undefined
      ) {
        updated = await updateKeySourceMeta(id, {
          priority: patch.priority as number | undefined,
          dailySpendCapUsd: patch.dailySpendCapUsd as number | null | undefined,
          label: patch.label as string | undefined,
        });
      }
      if (newStatus !== undefined) {
        await setStatus(id, newStatus);
        updated = true;
      }

      if (!updated) return res.status(404).json({ error: "not found" });
      return res.json({ ok: true });
    }),
  );

  // POST /:id/rotate  — atomic ciphertext swap, balance refresh.
  router.post(
    "/:id/rotate",
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });
      const apiKey = String(req.body?.api_key ?? "").trim();
      const reason = String(req.body?.reason ?? "").trim();
      if (apiKey.length < MIN_API_KEY || apiKey.length > MAX_API_KEY) {
        return res.status(400).json({ error: "api_key length out of bounds" });
      }
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      consumeRateLimit(admin, "provider_key_rotations");

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "rotate_provider_key",
        reason,
        payload: { id, api_key_tail: tail(apiKey) },
        context: extractAuditContext(req),
      });

      const rotated = await rotateKeySourceCiphertext(id, apiKey);
      if (!rotated) return res.status(404).json({ error: "not found" });
      return res.json({ ok: true, masked_key: tail(apiKey) });
    }),
  );

  // POST /:id/disable  — idempotent. Distinct route from PATCH so the UI
  // can wire a one-click button without round-tripping the full status enum.
  router.post(
    "/:id/disable",
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid id" });
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ error: "reason required" });

      const r = req as PlatformAdminRequest;
      const admin = r.platformAdmin.userId;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: admin,
        action: "disable_provider_key",
        reason,
        payload: { id },
        context: extractAuditContext(req),
      });

      await setStatus(id, "disabled");
      return res.json({ ok: true });
    }),
  );

  return router;
}
