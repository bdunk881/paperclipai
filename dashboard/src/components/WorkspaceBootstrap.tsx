import { useWorkspaceBootstrap } from "../hooks/useWorkspaceBootstrap";

/** Invisible prefetch coordinator — mount inside WorkspaceProvider. */
export function WorkspaceBootstrap() {
  useWorkspaceBootstrap();
  return null;
}
