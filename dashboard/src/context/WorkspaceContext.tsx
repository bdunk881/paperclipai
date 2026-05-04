import React from "react";
import { createWorkspace, listWorkspaces, type WorkspaceSummary } from "../api/workspaces";
import { useAuth } from "./AuthContext";
import {
  WORKSPACE_STORAGE_EVENT,
  clearStoredActiveWorkspaceId,
  readStoredActiveWorkspaceId,
  writeStoredActiveWorkspaceId,
} from "../workspaces/workspaceStorage";
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from "./workspaceContext.shared";

function sortWorkspaces(workspaces: WorkspaceSummary[]): WorkspaceSummary[] {
  return [...workspaces].sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  );
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { accessMode, getAccessToken } = useAuth();
  const [workspaces, setWorkspaces] = React.useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = React.useState<string | null>(() =>
    readStoredActiveWorkspaceId()
  );
  const [loading, setLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const syncSelection = React.useCallback(
    (nextWorkspaces: WorkspaceSummary[], preferredWorkspaceId?: string | null): string | null => {
      const candidateId = preferredWorkspaceId ?? activeWorkspaceId ?? readStoredActiveWorkspaceId();
      const selectedWorkspace =
        (candidateId ? nextWorkspaces.find((workspace) => workspace.id === candidateId) : undefined) ??
        nextWorkspaces[0] ??
        null;
      const nextWorkspaceId = selectedWorkspace?.id ?? null;

      setActiveWorkspaceIdState(nextWorkspaceId);
      if (nextWorkspaceId) {
        writeStoredActiveWorkspaceId(nextWorkspaceId);
      } else {
        clearStoredActiveWorkspaceId();
      }

      return nextWorkspaceId;
    },
    [activeWorkspaceId]
  );

  const refreshWorkspaces = React.useCallback(
    async (preferredWorkspaceId?: string) => {
      if (accessMode !== "authenticated") {
        setWorkspaces([]);
        setActiveWorkspaceIdState(null);
        setError(null);
        clearStoredActiveWorkspaceId();
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          setWorkspaces([]);
          setActiveWorkspaceIdState(null);
          clearStoredActiveWorkspaceId();
          return;
        }

        const nextWorkspaces = sortWorkspaces(await listWorkspaces(accessToken));
        setWorkspaces(nextWorkspaces);
        syncSelection(nextWorkspaces, preferredWorkspaceId);
      } catch (workspaceError) {
        setWorkspaces([]);
        setActiveWorkspaceIdState(null);
        setError(
          workspaceError instanceof Error ? workspaceError.message : "Failed to load workspaces"
        );
      } finally {
        setLoading(false);
      }
    },
    [accessMode, getAccessToken, syncSelection]
  );

  React.useEffect(() => {
    if (accessMode !== "authenticated") {
      setWorkspaces([]);
      setActiveWorkspaceIdState(null);
      setError(null);
      clearStoredActiveWorkspaceId();
      return;
    }

    void refreshWorkspaces();
  }, [accessMode, refreshWorkspaces]);

  React.useEffect(() => {
    const syncWorkspaceSelection = () => {
      setActiveWorkspaceIdState(readStoredActiveWorkspaceId());
    };

    window.addEventListener("storage", syncWorkspaceSelection);
    window.addEventListener(WORKSPACE_STORAGE_EVENT, syncWorkspaceSelection);

    return () => {
      window.removeEventListener("storage", syncWorkspaceSelection);
      window.removeEventListener(WORKSPACE_STORAGE_EVENT, syncWorkspaceSelection);
    };
  }, []);

  const setActiveWorkspaceId = React.useCallback((workspaceId: string) => {
    setActiveWorkspaceIdState(workspaceId);
    writeStoredActiveWorkspaceId(workspaceId);
    setError(null);
  }, []);

  const handleCreateWorkspace = React.useCallback(
    async (name: string) => {
      setCreating(true);
      setError(null);

      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          throw new Error("Authentication session expired. Sign in again to continue.");
        }

        const workspace = await createWorkspace(name, accessToken);
        await refreshWorkspaces(workspace.id);
        return workspace;
      } catch (workspaceError) {
        const message =
          workspaceError instanceof Error ? workspaceError.message : "Failed to create workspace";
        setError(message);
        throw new Error(message);
      } finally {
        setCreating(false);
      }
    },
    [getAccessToken, refreshWorkspaces]
  );

  const activeWorkspace = React.useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces]
  );

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspace,
      activeWorkspaceId,
      loading,
      creating,
      error,
      setActiveWorkspaceId,
      refreshWorkspaces,
      createWorkspace: handleCreateWorkspace,
    }),
    [
      activeWorkspace,
      activeWorkspaceId,
      creating,
      error,
      handleCreateWorkspace,
      loading,
      refreshWorkspaces,
      setActiveWorkspaceId,
      workspaces,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
