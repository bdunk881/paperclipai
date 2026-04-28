import { User } from "../context/AuthContext";
import { getConfiguredApiOrigin } from "./baseUrl";

const API_BASE = getConfiguredApiOrigin();

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function buildHeaders(
  user: User | null,
  accessToken: string,
  contentType = true
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (user?.id) headers["X-User-Id"] = user.id;
  return headers;
}

async function parseError(res: Response): Promise<ApiError> {
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  const message = payload?.error ?? `${res.status} ${res.statusText}`;
  return new ApiError(message, res.status);
}

export async function apiGet<T>(path: string, user: User | null, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: buildHeaders(user, accessToken, false) });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, user: User | null, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: buildHeaders(user, accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown, user: User | null, accessToken: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: buildHeaders(user, accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

export async function apiDelete(path: string, user: User | null, accessToken: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: buildHeaders(user, accessToken, false),
  });
  if (!res.ok && res.status !== 204) throw await parseError(res);
}
