import { readStoredAuthUser } from "../auth/authStorage";
import { trackedFetch } from "./trackedFetch";
import { getApiBasePath } from "./baseUrl";

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
}

const BASE = getApiBasePath();

function buildAuthHeaders(accessToken?: string): HeadersInit {
  const headers: Record<string, string> = {};

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
    return headers;
  }

  const storedUser = readStoredAuthUser();
  if (storedUser?.id) {
    headers["X-User-Id"] = storedUser.id;
  }

  return headers;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export async function listWorkspaces(accessToken?: string): Promise<WorkspaceSummary[]> {
  const res = await trackedFetch(`${BASE}/workspaces`, {
    headers: buildAuthHeaders(accessToken),
  });

  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to load workspaces: ${res.status}`));
  }

  return (await res.json()) as WorkspaceSummary[];
}

export async function createWorkspace(name: string, accessToken?: string): Promise<WorkspaceSummary> {
  const res = await trackedFetch(`${BASE}/workspaces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Paperclip-Run-Id": crypto.randomUUID(),
      ...buildAuthHeaders(accessToken),
    },
    body: JSON.stringify({ name }),
  });

  if (!res.ok) {
    throw new Error(await readApiError(res, `Failed to create workspace: ${res.status}`));
  }

  return (await res.json()) as WorkspaceSummary;
}
