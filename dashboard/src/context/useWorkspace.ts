import { useContext } from "react";
import { WorkspaceContext, type WorkspaceContextValue } from "./workspaceContext.shared";

export function useWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext);
}
