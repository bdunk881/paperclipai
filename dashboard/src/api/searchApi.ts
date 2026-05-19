import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";

const BASE = getApiBasePath();

export type SearchEntityType = "mission" | "agent" | "routine" | "approval";

export interface GlobalSearchResult {
  type: SearchEntityType;
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  route: string;
  matchedFields: string[];
  updatedAt: string | null;
}

export interface GlobalSearchResponse {
  query: string;
  results: GlobalSearchResult[];
  total: number;
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Search failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function searchEntities(
  accessToken: string,
  query: string,
  limit = 8,
): Promise<GlobalSearchResponse> {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("limit", String(limit));

  const res = await trackedFetch(`${BASE}/search?${params.toString()}`, {
    headers: authHeaders(accessToken),
  });

  return readJson<GlobalSearchResponse>(res);
}
