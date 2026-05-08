const WORKSPACE_CLAIM_KEYS = [
  "workspaceId",
  "workspace_id",
  "extension_workspaceId",
  "extension_workspace_id",
  "https://autoflow.ai/workspaceId",
  "https://autoflow.ai/workspace_id",
];

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, rawPayload] = token.split(".");
  if (!rawPayload) {
    return null;
  }

  try {
    const normalized = rawPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getWorkspaceClaimFromAccessToken(accessToken?: string | null): string | null {
  if (!accessToken) {
    return null;
  }

  const payload = decodeJwtPayload(accessToken);
  if (!payload) {
    return null;
  }

  for (const key of WORKSPACE_CLAIM_KEYS) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    if (!/workspace(_id|Id)$/i.test(key)) {
      continue;
    }

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}
