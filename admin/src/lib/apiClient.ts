import { getAccessToken } from "./supabase";
import { emitStepUpRequired } from "../auth/stepUpEvents";

function resolveBaseUrl(): string {
  const explicit = String(import.meta.env.VITE_API_BASE_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  // Local dev — vite proxy forwards /api to localhost:3000.
  return "";
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    const detail =
      body && typeof body === "object" && "error" in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).error)
        : `HTTP ${status}`;
    super(detail);
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
}

export async function apiRequest<T = unknown>(
  path: string,
  opts: ApiRequestOptions = {},
): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(resolveBaseUrl() + path, window.location.origin);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "include",
  });
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    if (
      res.status === 401 &&
      body &&
      typeof body === "object" &&
      (body as { error?: unknown }).error === "mfa_step_up_required"
    ) {
      const reason = (body as { reason?: unknown }).reason;
      emitStepUpRequired({ reason: typeof reason === "string" ? reason : undefined });
    }
    throw new ApiError(res.status, body);
  }
  return body as T;
}
