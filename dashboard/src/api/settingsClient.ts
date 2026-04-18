import { User } from "../context/AuthContext";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function buildHeaders(user: User | null, contentType = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = "application/json";
  if (user?.id) headers["X-User-Id"] = user.id;
  return headers;
}

async function parseError(res: Response): Promise<ApiError> {
  const payload = (await res.json().catch(() => null)) as { error?: string } | null;
  const message = payload?.error ?? `${res.status} ${res.statusText}`;
  return new ApiError(message, res.status);
}

export async function apiGet<T>(path: string, user: User | null): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: buildHeaders(user, false) });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, user: User | null): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: buildHeaders(user),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown, user: User | null): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: buildHeaders(user),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

export async function apiDelete(path: string, user: User | null): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: buildHeaders(user, false),
  });
  if (!res.ok && res.status !== 204) throw await parseError(res);
}

