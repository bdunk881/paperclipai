export interface StoredAuthUser {
  id: string;
  email: string;
  name: string;
  tenantId?: string;
}

export const AUTH_STORAGE_KEY = "autoflow_user";
export const AUTH_STORAGE_EVENT = "autoflow-auth-user-changed";

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

export function readStoredAuthUser(): StoredAuthUser | null {
  if (typeof window === "undefined") return null;

  const raw = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return isStoredAuthUser(parsed) ? parsed : null;
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
