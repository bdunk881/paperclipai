/**
 * HEL-69: shared Jest auto-mock for the workspace resolver.
 *
 * Test files opt in with:
 *
 *   jest.mock("../middleware/workspaceResolver");        // any depth
 *
 * Behavior:
 *   - `req.workspace = { id, role: "owner" }` is ALWAYS set, so any
 *     `requireRole(...)` gate that this test file's routes mount will pass.
 *     (Owner passes every role check by design.)
 *   - `req.workspaceId` (legacy) is set only when the test passes
 *     `X-Workspace-Id` explicitly. Leaving it `undefined` otherwise preserves
 *     pre-HEL-69 behavior for handlers that read it as "no filter".
 *   - Per-role denial behavior lives in `requireRole.test.ts`; this mock
 *     intentionally bypasses it so unit tests don't have to spoof roles to
 *     exercise route handlers.
 *
 * Re-exports `WorkspaceRole` and `WorkspaceAwareRequest` from the real
 * module so test code that imports the types still typechecks.
 */

export {
  WorkspaceAwareRequest,
  WorkspaceRole,
} from "../workspaceResolver";

const DEFAULT_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

function stub(
  req: {
    headers?: Record<string, string | undefined>;
    workspaceId?: string;
    workspace?: { id: string; role: string };
    auth?: { workspaceId?: string };
  },
  _res: unknown,
  next: () => void,
): void {
  const explicitWorkspaceId = req.headers?.["x-workspace-id"]?.trim();
  if (explicitWorkspaceId) {
    req.workspaceId = explicitWorkspaceId;
  }
  const workspaceIdForRole =
    explicitWorkspaceId || req.auth?.workspaceId || DEFAULT_WORKSPACE_ID;
  req.workspace = { id: workspaceIdForRole, role: "owner" };
  next();
}

export function createWorkspaceResolver() {
  return stub;
}

export function createExplicitWorkspaceHeaderResolver() {
  return stub;
}
