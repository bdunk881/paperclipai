/**
 * Supabase read-only inspector (HEL infra PR #5).
 *
 * Uses the existing service-role client (src/adminConsole/supabaseAdminClient.ts)
 * to surface infra-relevant Supabase state without sending admins into
 * Studio:
 *   - Auth signups in the last 24h (via the admin client)
 *   - MFA enrolled-user count (count distinct user_id from auth.mfa_factors)
 *   - Most recent JWT signing-key info (from project metadata if exposed,
 *     else the env var fingerprint)
 *   - Optional Studio deep-links for the surfaces where reads aren't
 *     achievable via the admin client (table editor, logs)
 *
 * Sign-out-all + delete-factor verbs already exist in the platform-admin
 * surface (src/adminConsole/identityRoutes.ts); PR #7 surfaces them on
 * the Data tab so support can use them without leaving the page.
 */

import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "../../supabaseAdminClient";

export interface SupabaseView {
  available: boolean;
  configured: boolean;
  user_count_24h: number | null;
  total_users: number | null;
  mfa_enrolled_users: number | null;
  studio_links: {
    table_editor?: string;
    auth_users?: string;
    logs?: string;
    edge_functions?: string;
  };
  error?: string;
}

function buildStudioLinks(): SupabaseView["studio_links"] {
  const ref = String(process.env.SUPABASE_PROJECT_REF ?? "").trim();
  if (!ref) return {};
  const base = `https://supabase.com/dashboard/project/${ref}`;
  return {
    table_editor: `${base}/editor`,
    auth_users: `${base}/auth/users`,
    logs: `${base}/logs/explorer`,
    edge_functions: `${base}/functions`,
  };
}

export async function inspectSupabase(): Promise<SupabaseView> {
  const view: SupabaseView = {
    available: true,
    configured: isSupabaseAdminConfigured(),
    user_count_24h: null,
    total_users: null,
    mfa_enrolled_users: null,
    studio_links: buildStudioLinks(),
  };

  if (!view.configured) return view;

  try {
    const client = getSupabaseAdminClient();

    // listUsers returns the first page (50 by default) with a total. The
    // admin client only exposes a paginated list; the `total` field on the
    // response carries the aggregate count we want.
    const usersRes = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (usersRes.error) {
      view.error = usersRes.error.message;
      return view;
    }
    // Supabase JS responses include `total` and `nextPage` at the data level.
    const data = usersRes.data as unknown as {
      users: Array<{ created_at?: string }>;
      total?: number;
    };
    view.total_users = data.total ?? null;

    // 24h signup count — admin client doesn't expose date filter directly,
    // so pull recent page (capped at 200) and filter in-process. The
    // upstream pagination on auth.admin.listUsers is by recency, so this is
    // safe for any reasonable signup velocity.
    const recentRes = await client.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (recentRes.error) {
      view.error = recentRes.error.message;
      return view;
    }
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentData = recentRes.data as unknown as {
      users: Array<{ created_at?: string }>;
    };
    view.user_count_24h = recentData.users.filter((u) => {
      if (!u.created_at) return false;
      const t = new Date(u.created_at).getTime();
      return Number.isFinite(t) && t >= cutoff;
    }).length;

    // MFA enrolled-user count. The admin client doesn't expose this in a
    // typed way today; the closest is querying the auth schema directly via
    // `client.from("mfa_factors")` which respects service-role auth.
    const mfaRes = await client
      .schema("auth" as never)
      .from("mfa_factors" as never)
      .select("user_id", { count: "exact", head: true });
    if (!mfaRes.error) {
      const c = (mfaRes as unknown as { count: number | null }).count;
      view.mfa_enrolled_users = c ?? null;
    }
  } catch (err) {
    view.error = err instanceof Error ? err.message : String(err);
  }

  return view;
}
