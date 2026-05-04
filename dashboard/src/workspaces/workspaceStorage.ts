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

export function withActiveWorkspaceHeader(headers?: HeadersInit): HeadersInit | undefined {
  const workspaceId = readStoredActiveWorkspaceId();

  if (!workspaceId) {
    return headers;
  }

  if (headers instanceof Headers) {
    const nextHeaders = new Headers(headers);
    nextHeaders.set("X-Workspace-Id", workspaceId);
    return nextHeaders;
  }

  if (Array.isArray(headers)) {
    return [...headers, ["X-Workspace-Id", workspaceId]];
  }

  return {
    ...(headers ?? {}),
    "X-Workspace-Id": workspaceId,
  };
}
