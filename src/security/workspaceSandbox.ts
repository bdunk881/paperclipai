/**
 * Workspace-scoped filesystem sandbox primitive (ALT-2057, Phase 4.2c).
 *
 * Resolves an agent-controlled path against a workspace-scoped sandbox root
 * and rejects anything that escapes the root. Designed to be called before
 * any open/read/write so a path-traversal payload (`../etc/passwd`,
 * absolute paths, symlink-style escapes) is refused before reaching the
 * filesystem layer.
 *
 * Use:
 *
 *   const safe = resolveWithinWorkspaceSandbox(rootForWorkspace(workspaceId), userPath);
 *   await fs.readFile(safe);
 *
 * The helper does not touch the filesystem itself — it is a pure path check.
 * It is the caller's responsibility to use the returned path for the actual
 * I/O. This keeps the helper synchronous and side-effect free, which makes
 * it cheap to call from any code path.
 */

import { isAbsolute, resolve, relative, sep } from "node:path";

export class WorkspaceSandboxError extends Error {
  constructor(message: string, readonly code: WorkspaceSandboxErrorCode) {
    super(message);
    this.name = "WorkspaceSandboxError";
  }
}

export type WorkspaceSandboxErrorCode =
  | "missing_root"
  | "missing_path"
  | "absolute_path"
  | "escapes_sandbox";

/**
 * Resolves `relativePath` against `sandboxRoot` and returns the absolute
 * path if and only if the resolved path is contained within the root.
 *
 * Throws WorkspaceSandboxError otherwise.
 */
export function resolveWithinWorkspaceSandbox(
  sandboxRoot: string,
  relativePath: string,
): string {
  if (!sandboxRoot || sandboxRoot.trim().length === 0) {
    throw new WorkspaceSandboxError(
      "Workspace sandbox root is required",
      "missing_root",
    );
  }
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new WorkspaceSandboxError(
      "Path is required",
      "missing_path",
    );
  }

  if (isAbsolute(relativePath)) {
    throw new WorkspaceSandboxError(
      "Absolute paths are not allowed; pass a path relative to the workspace sandbox",
      "absolute_path",
    );
  }

  const absoluteRoot = resolve(sandboxRoot);
  const candidate = resolve(absoluteRoot, relativePath);
  const rel = relative(absoluteRoot, candidate);

  // `relative` returns "" when the paths are identical, "..", or a path
  // starting with `..${sep}` when `candidate` is outside `absoluteRoot`.
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new WorkspaceSandboxError(
      `Path escapes workspace sandbox: ${relativePath}`,
      "escapes_sandbox",
    );
  }

  return candidate;
}

/**
 * Boolean form of `resolveWithinWorkspaceSandbox`. Returns true iff the
 * path resolves cleanly inside the sandbox; never throws.
 */
export function isWithinWorkspaceSandbox(
  sandboxRoot: string,
  relativePath: string,
): boolean {
  try {
    resolveWithinWorkspaceSandbox(sandboxRoot, relativePath);
    return true;
  } catch {
    return false;
  }
}
