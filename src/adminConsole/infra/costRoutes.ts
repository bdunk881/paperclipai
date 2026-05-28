/**
 * Cost / billing reads for the Infrastructure dashboard (HEL follow-up).
 *
 * Mounted at /api/admin-console/infra/cost. Surfaces spend visibility
 * across the platform's two biggest cost surfaces (OpenRouter LLM spend +
 * Fly compute) and links out to the rest. Read-only — no mutations here.
 *
 * Source-of-truth notes:
 *   - OpenRouter spend: sum(wholesale_cost_usd) from workspace_credit_ledger
 *     over a parameterized window. This is the same accounting the
 *     openrouter watchdog uses for low-balance detection — keeps spend
 *     numbers consistent across the admin UI.
 *   - Fly cost: no public billing API, so we surface machine count +
 *     region distribution. Admins clicking "open Fly dashboard" can see
 *     the invoiced number.
 *   - Cloudflare: free tier covers AutoFlow usage, so we surface
 *     "projects + recent deploy count" as activity instead of cost.
 *   - Supabase: deep-link to the Studio billing page via
 *     SUPABASE_PROJECT_REF.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAAL2 } from "../../middleware/requireAAL2";
import { recordAdminAction } from "../auditLog";
import { extractAuditContext, type PlatformAdminRequest } from "../types";
import {
  getConfiguredFlyApps,
  listMachinesForApps,
} from "./clients/flyClient";
import {
  getConfiguredCloudflareProjects,
  listProjectViews,
} from "./clients/cloudflareClient";
import {
  COST_BUCKETS,
  COST_METRICS,
  createThreshold,
  disableThreshold,
  evaluateBreaches,
  listActiveThresholds,
  updateThreshold,
  type BreachStatus,
  type CostBucket,
  type CostMetric,
  type CostThreshold,
} from "./costThresholdsStore";

export interface SpendWindow {
  hours: number;
  spend_usd: number;
}

export interface OpenRouterSpendSummary {
  configured: boolean;
  prepaid_balance_usd: number | null;
  prepaid_balance_observed_at: string | null;
  trailing_24h: SpendWindow;
  trailing_7d: SpendWindow;
  trailing_30d: SpendWindow;
  /** Projected daily spend = trailing-7d-spend / 7. */
  projected_daily_usd: number;
  /** Projected monthly = projected-daily * 30. */
  projected_monthly_usd: number;
}

export interface FlySpendSummary {
  configured: boolean;
  total_machines: number;
  by_app: Array<{ app: string; machines: number; regions: string[] }>;
}

export interface CloudflareActivitySummary {
  configured: boolean;
  project_count: number;
  recent_deploys_total: number;
}

export interface SupabaseLinks {
  configured: boolean;
  billing_url: string | null;
}

export interface InfraCostResponse {
  openrouter: OpenRouterSpendSummary;
  fly: FlySpendSummary;
  cloudflare: CloudflareActivitySummary;
  supabase: SupabaseLinks;
  thresholds: CostThreshold[];
  breaches: BreachStatus[];
}

async function openrouterSpend(
  client: import("pg").PoolClient,
): Promise<OpenRouterSpendSummary> {
  // The platform_provider_keys row is the source of truth for the prepaid
  // balance; the wholesale ledger is the source of truth for spend.
  const [balanceRes, spendRes] = await Promise.all([
    client.query<{ prepaid_balance_usd: string | null; prepaid_balance_observed_at: Date | null }>(
      `SELECT prepaid_balance_usd::text AS prepaid_balance_usd, prepaid_balance_observed_at
         FROM platform_provider_keys
        WHERE source_kind = 'openrouter'
          AND status IN ('active', 'low_balance')
        ORDER BY created_at ASC
        LIMIT 1`,
    ),
    client.query<{ window_hours: string; spend_usd: string }>(
      `SELECT '24'::text AS window_hours,
              COALESCE(SUM(wholesale_cost_usd), 0)::text AS spend_usd
         FROM workspace_credit_ledger
        WHERE type = 'consumption' AND created_at > now() - INTERVAL '24 hours'
       UNION ALL
       SELECT '168'::text,
              COALESCE(SUM(wholesale_cost_usd), 0)::text
         FROM workspace_credit_ledger
        WHERE type = 'consumption' AND created_at > now() - INTERVAL '7 days'
       UNION ALL
       SELECT '720'::text,
              COALESCE(SUM(wholesale_cost_usd), 0)::text
         FROM workspace_credit_ledger
        WHERE type = 'consumption' AND created_at > now() - INTERVAL '30 days'`,
    ),
  ]);

  const by = (h: string): SpendWindow => {
    const row = spendRes.rows.find((r) => r.window_hours === h);
    return { hours: Number(h), spend_usd: Number(row?.spend_usd ?? "0") };
  };

  const t7 = by("168");
  const projectedDaily = t7.spend_usd / 7;

  return {
    configured: true,
    prepaid_balance_usd:
      balanceRes.rows[0]?.prepaid_balance_usd != null
        ? Number(balanceRes.rows[0].prepaid_balance_usd)
        : null,
    prepaid_balance_observed_at:
      balanceRes.rows[0]?.prepaid_balance_observed_at?.toISOString() ?? null,
    trailing_24h: by("24"),
    trailing_7d: t7,
    trailing_30d: by("720"),
    projected_daily_usd: projectedDaily,
    projected_monthly_usd: projectedDaily * 30,
  };
}

async function flyActivity(): Promise<FlySpendSummary> {
  if (!process.env.FLY_API_TOKEN) {
    return { configured: false, total_machines: 0, by_app: [] };
  }
  const apps = getConfiguredFlyApps();
  const views = await listMachinesForApps(apps).catch(() =>
    apps.map((appName) => ({ appName, machines: [], error: "unreachable" })),
  );
  const by_app = views.map((v) => ({
    app: v.appName,
    machines: v.machines.length,
    regions: Array.from(new Set(v.machines.map((m) => m.region))).sort(),
  }));
  return {
    configured: true,
    total_machines: by_app.reduce((acc, a) => acc + a.machines, 0),
    by_app,
  };
}

async function cloudflareActivity(): Promise<CloudflareActivitySummary> {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    return { configured: false, project_count: 0, recent_deploys_total: 0 };
  }
  const projects = await listProjectViews(getConfiguredCloudflareProjects()).catch(() => []);
  return {
    configured: true,
    project_count: projects.length,
    recent_deploys_total: projects.reduce((acc, p) => acc + p.deployments.length, 0),
  };
}

function supabaseLinks(): SupabaseLinks {
  const ref = String(process.env.SUPABASE_PROJECT_REF ?? "").trim();
  if (!ref) return { configured: false, billing_url: null };
  return {
    configured: true,
    billing_url: `https://supabase.com/dashboard/project/${ref}/settings/billing`,
  };
}

export function createCostRoutes(_pool: Pool): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: r.platformAdmin.userId,
        action: "view_infra_cost",
        reason: "",
        context: extractAuditContext(req),
      });

      const [openrouter, fly, cloudflare, thresholds] = await Promise.all([
        openrouterSpend(client),
        flyActivity(),
        cloudflareActivity(),
        listActiveThresholds(client),
      ]);
      const supabase = supabaseLinks();
      const partialPayload = { openrouter, fly, cloudflare, supabase };
      const breaches = evaluateBreaches(
        thresholds,
        partialPayload as unknown as Record<string, unknown>,
      );

      const payload: InfraCostResponse = {
        ...partialPayload,
        thresholds,
        breaches,
      };
      res.json(payload);
    }),
  );

  // ---- Threshold CRUD (under requireAAL2; same pattern as the rest of
  // the infra mutation routes) ---------------------------------------------
  const mutations = Router();
  mutations.use(requireAAL2);

  function validateMetric(value: unknown): CostMetric | null {
    return typeof value === "string" && (COST_METRICS as string[]).includes(value)
      ? (value as CostMetric)
      : null;
  }
  function validateBucket(value: unknown): CostBucket | null {
    return typeof value === "string" && (COST_BUCKETS as string[]).includes(value)
      ? (value as CostBucket)
      : null;
  }
  function validateCeiling(value: unknown): number | null {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }
  function requireReason(body: unknown): string | null {
    const reason = body && typeof body === "object" ? (body as { reason?: unknown }).reason ?? "" : "";
    if (typeof reason !== "string") return null;
    const t = reason.trim();
    return t.length >= 4 ? t : null;
  }

  mutations.post(
    "/thresholds",
    asyncHandler(async (req, res) => {
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const metric = validateMetric((req.body as Record<string, unknown> | undefined)?.metric);
      if (!metric) return res.status(400).json({ error: "invalid_metric" });
      const bucket = validateBucket((req.body as Record<string, unknown> | undefined)?.bucket);
      if (!bucket) return res.status(400).json({ error: "invalid_bucket" });
      const ceiling = validateCeiling((req.body as Record<string, unknown> | undefined)?.ceiling_value);
      if (ceiling === null) return res.status(400).json({ error: "invalid_ceiling_value" });
      const noteRaw = (req.body as Record<string, unknown> | undefined)?.note;
      const note = typeof noteRaw === "string" && noteRaw.trim().length > 0 ? noteRaw.trim() : null;

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "create_cost_threshold",
        reason,
        payload: { metric, bucket, ceiling_value: ceiling, note },
        context: extractAuditContext(req),
      });

      try {
        const threshold = await createThreshold(client, {
          metric,
          bucket,
          ceilingValue: ceiling,
          note,
          createdBy: adminId,
        });
        res.status(201).json({ threshold });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("admin_cost_thresholds_unique_active")) {
          return res.status(409).json({
            error: "active_threshold_exists",
            hint: "Disable the existing threshold first, then create a replacement.",
          });
        }
        throw err;
      }
    }),
  );

  mutations.patch(
    "/thresholds/:id",
    asyncHandler(async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: "invalid_id" });
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });
      const body = (req.body ?? {}) as Record<string, unknown>;
      let ceilingValue: number | undefined;
      if (body.ceiling_value !== undefined) {
        const v = validateCeiling(body.ceiling_value);
        if (v === null) return res.status(400).json({ error: "invalid_ceiling_value" });
        ceilingValue = v;
      }
      let note: string | null | undefined;
      if (body.note !== undefined) {
        note = typeof body.note === "string" && body.note.trim().length > 0 ? body.note.trim() : null;
      }

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      await recordAdminAction(client, {
        adminUserId: r.platformAdmin.userId,
        action: "update_cost_threshold",
        reason,
        payload: { id, ceiling_value: ceilingValue, note },
        context: extractAuditContext(req),
      });
      const updated = await updateThreshold(client, { id, ceilingValue, note });
      if (!updated) return res.status(404).json({ error: "not_found" });
      res.json({ threshold: updated });
    }),
  );

  mutations.delete(
    "/thresholds/:id",
    asyncHandler(async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: "invalid_id" });
      const reason = requireReason(req.body);
      if (!reason) return res.status(400).json({ error: "reason_required_min_4_chars" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      await recordAdminAction(client, {
        adminUserId: r.platformAdmin.userId,
        action: "disable_cost_threshold",
        reason,
        payload: { id },
        context: extractAuditContext(req),
      });
      const ok = await disableThreshold(client, id);
      if (!ok) return res.status(404).json({ error: "not_found_or_already_disabled" });
      res.status(204).end();
    }),
  );

  router.use("/", mutations);
  return router;
}
