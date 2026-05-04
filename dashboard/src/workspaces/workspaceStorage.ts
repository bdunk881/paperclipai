export const ACTIVE_WORKSPACE_STORAGE_KEY = "autoflow_active_workspace_id";
export const WORKSPACE_STORAGE_EVENT = "autoflow-workspace-changed";

function dispatchWorkspaceStorageEvent(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(WORKSPACE_STORAGE_EVENT));
}

export function readStoredActiveWorkspaceId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)?.trim();
  return value ? value : null;
}

export function writeStoredActiveWorkspaceId(workspaceId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
  dispatchWorkspaceStorageEvent();
}

export function clearStoredActiveWorkspaceId(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  dispatchWorkspaceStorageEvent();
}

export function withActiveWorkspaceHeader(headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers ?? {});
  const workspaceId = readStoredActiveWorkspaceId();

  if (workspaceId) {
    nextHeaders.set("X-Workspace-Id", workspaceId);
  }

  return nextHeaders;
}
