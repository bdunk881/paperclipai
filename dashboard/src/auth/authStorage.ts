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
}

export const AUTH_STORAGE_KEY = "autoflow_user";
export const AUTH_SESSION_STORAGE_KEY = "autoflow_auth_session";
export const AUTH_STORAGE_EVENT = "autoflow-auth-user-changed";

// Sensitive tokens kept in memory only — never persisted to browser storage.
let inMemoryRefreshToken: string | undefined;

export function getInMemoryRefreshToken(): string | undefined {
  return inMemoryRefreshToken;
}

export function setInMemoryRefreshToken(token: string | undefined): void {
  inMemoryRefreshToken = token;
}

function isStoredAuthUser(value: unknown): value is StoredAuthUser {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.name === "string"
  );
}

function dispatchAuthStorageEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_STORAGE_EVENT));
}

function isStoredAuthSession(value: unknown): value is StoredAuthSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessToken === "string" &&
    typeof candidate.expiresAt === "number" &&
    isStoredAuthUser(candidate.user)
  );
}

export function readStoredAuthSession(): StoredAuthSession | null {
  if (typeof window === "undefined") return null;

  const raw = window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return isStoredAuthSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readStoredAuthUser(): StoredAuthUser | null {
  if (typeof window === "undefined") return null;

  const raw = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) {
    return readStoredAuthSession()?.user ?? null;
  }

  try {
    const parsed = JSON.parse(raw);
    return isStoredAuthUser(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredAuthSession(session: StoredAuthSession): void {
  if (typeof window === "undefined") return;
  // Keep refresh token in memory only — strip from persisted storage.
  inMemoryRefreshToken = session.refreshToken;
  const { refreshToken: _rt, idToken: _id, ...persistable } = session;
  void _rt; void _id;
  window.sessionStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(persistable));
  window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session.user));
  dispatchAuthStorageEvent();
}

export function writeStoredAuthUser(user: StoredAuthUser): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  dispatchAuthStorageEvent();
}

export function clearStoredAuthSession(): void {
  if (typeof window === "undefined") return;
  inMemoryRefreshToken = undefined;
  window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
  dispatchAuthStorageEvent();
}

export function clearStoredAuthUser(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
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
