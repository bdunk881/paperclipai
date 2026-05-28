import { apiRequest } from "../lib/apiClient";

interface BaseInput {
  reason: string;
}

export async function killPostgresQuery(
  input: BaseInput & { pid: number },
): Promise<{ ok: boolean; terminated_pid: number | null }> {
  return apiRequest<{ ok: boolean; terminated_pid: number | null }>(
    "/api/admin-console/infra/data/actions/postgres/kill-query",
    { method: "POST", body: { reason: input.reason, pid: input.pid } },
  );
}

export async function flushRedisPattern(
  input: BaseInput & { pattern: string; confirm: string },
): Promise<{ ok: boolean; deleted: number; scan_complete: boolean }> {
  return apiRequest<{ ok: boolean; deleted: number; scan_complete: boolean }>(
    "/api/admin-console/infra/data/actions/redis/flush-pattern",
    {
      method: "POST",
      body: { reason: input.reason, pattern: input.pattern, confirm: input.confirm },
    },
  );
}
