export interface StoredAuthUser {
  id: string;
  email: string;
  name: string;
  tenantId?: string;
}

export interface StoredAuthSession {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  scope?: string;
  user: StoredAuthUser;
  authProvider?: "supabase" | "preview" | "native" | "social" | "microsoft";
}

export const AUTH_STORAGE_KEY = "autoflow_user";
export const AUTH_STORAGE_EVENT = "autoflow-auth-user-changed";

function parseStoredAuthUser(value: unknown): StoredAuthUser | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.trim() === "") {
    return null;
  }

  const id = candidate.id.trim();
  const email = typeof candidate.email === "string" ? candidate.email : "";
  const name =
    typeof candidate.name === "string" && candidate.name.trim() !== ""
      ? candidate.name
      : email || id;
  const tenantId = typeof candidate.tenantId === "string" ? candidate.tenantId : undefined;

  return { id, email, name, tenantId };
}

function dispatchAuthStorageEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_STORAGE_EVENT));
}

export function readStoredAuthUser(): StoredAuthUser | null {
  if (typeof window === "undefined") return null;

  const raw = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parseStoredAuthUser(parsed);
  } catch {
    return null;
  }
}

export function writeStoredAuthUser(user: StoredAuthUser): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  dispatchAuthStorageEvent();
}

export function clearStoredAuthUser(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
  dispatchAuthStorageEvent();
}

export function readQaPreviewToken(search: string = window.location.search): string | null {
  const params = new URLSearchParams(search);
  const token = params.get("qaPreviewToken")?.trim();
  return token ? token : null;
}

export function sanitizeQaPreviewRedirect(target: string | null | undefined): string | null {
  if (!target) return null;
  if (!target.startsWith("/")) return null;
  if (target.startsWith("//")) return null;
  return target;
}
