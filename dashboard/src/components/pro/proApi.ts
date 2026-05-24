/**
 * proApi — HEL-214 helper for Pro Mode reveal API calls.
 *
 * Thin wrapper around `trackedFetch` so each reveal component can issue a
 * single typed request without re-stamping auth-header boilerplate. Routes
 * are scaffold-only on the server side (each returns a placeholder JSON
 * body marked with `// TODO: HEL-214 wire real implementation`).
 */
import { getApiBasePath } from "../../api/baseUrl";
import { trackedFetch } from "../../api/trackedFetch";

function authHeaders(token: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function proPost<T>(
  path: string,
  body: unknown,
  accessToken: string | null,
): Promise<T> {
  const res = await trackedFetch(`${getApiBasePath()}${path}`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Pro reveal request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export async function proGet<T>(
  path: string,
  accessToken: string | null,
): Promise<T> {
  const res = await trackedFetch(`${getApiBasePath()}${path}`, {
    method: "GET",
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Pro reveal request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}
