import { createContext } from "react";
import type { WorkspaceSummary } from "../api/workspaces";
import {
  clearStoredActiveWorkspaceId,
  readStoredActiveWorkspaceId,
  writeStoredActiveWorkspaceId,
} from "../workspaces/workspaceStorage";

export interface WorkspaceContextValue {
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceSummary | null;
  activeWorkspaceId: string | null;
  loading: boolean;
  creating: boolean;
  error: string | null;
  setActiveWorkspaceId: (workspaceId: string) => void;
  refreshWorkspaces: (preferredWorkspaceId?: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<WorkspaceSummary>;
}

export const defaultWorkspaceContextValue: WorkspaceContextValue = {
  workspaces: [],
  activeWorkspace: null,
  activeWorkspaceId: readStoredActiveWorkspaceId(),
  loading: false,
  creating: false,
  error: null,
  setActiveWorkspaceId: (workspaceId: string) => {
    writeStoredActiveWorkspaceId(workspaceId);
  },
  refreshWorkspaces: async () => {},
  createWorkspace: async () => {
    clearStoredActiveWorkspaceId();
    throw new Error("Workspace provider is unavailable.");
  },
};

export const WorkspaceContext = createContext<WorkspaceContextValue>(defaultWorkspaceContextValue);
