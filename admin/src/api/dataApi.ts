import { apiRequest } from "../lib/apiClient";

export interface PgPoolStats {
  total: number;
  idle: number;
  waiting: number;
  configured_max: number | null;
}

export interface PgActivitySummary {
  total: number;
  active: number;
  idle: number;
  idle_in_transaction: number;
  fastpath_function_call: number;
  disabled: number;
}

export interface PgLongQuery {
  pid: number;
  username: string | null;
  application_name: string | null;
  state: string | null;
  age_seconds: number;
  wait_event_type: string | null;
  wait_event: string | null;
  query_excerpt: string;
}

export interface PgHotTable {
  schema: string;
  name: string;
  approx_rows: number;
  size_bytes: number;
  total_size_bytes: number;
}

export interface PgInspectorView {
  available: boolean;
  pool: PgPoolStats | null;
  activity: PgActivitySummary | null;
  long_queries: PgLongQuery[];
  db_size_bytes: number | null;
  hot_tables: PgHotTable[];
  error?: string;
}

export interface RedisKeyspaceStats {
  db: string;
  keys: number;
  expires: number;
  avg_ttl_ms: number;
}

export interface RedisView {
  available: boolean;
  reachable: boolean;
  version: string | null;
  uptime_seconds: number | null;
  connected_clients: number | null;
  blocked_clients: number | null;
  used_memory_bytes: number | null;
  used_memory_peak_bytes: number | null;
  used_memory_rss_bytes: number | null;
  ops_per_sec: number | null;
  total_commands_processed: number | null;
  hits: number | null;
  misses: number | null;
  keyspace: RedisKeyspaceStats[];
  persistence: {
    aof_enabled: boolean | null;
    rdb_last_save: number | null;
    rdb_changes_since_last_save: number | null;
  };
  error?: string;
}

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

export interface InfraData {
  postgres: PgInspectorView;
  redis: RedisView;
  supabase: SupabaseView;
}

export async function fetchInfraData(): Promise<InfraData> {
  return apiRequest<InfraData>("/api/admin-console/infra/data");
}
