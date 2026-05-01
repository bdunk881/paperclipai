import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import {
  isWithinWorkspaceSandbox,
  resolveWithinWorkspaceSandbox,
  WorkspaceSandboxError,
} from "./workspaceSandbox";

describe("resolveWithinWorkspaceSandbox", () => {
  let sandboxRoot: string;

  beforeAll(() => {
    sandboxRoot = mkdtempSync(join(tmpdir(), "alt-2057-sandbox-"));
  });

  afterAll(() => {
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it("resolves a simple file inside the sandbox", () => {
    const result = resolveWithinWorkspaceSandbox(sandboxRoot, "agent-output.txt");
    expect(result).toBe(resolve(sandboxRoot, "agent-output.txt"));
  });

  it("resolves a nested file inside the sandbox", () => {
    const result = resolveWithinWorkspaceSandbox(
      sandboxRoot,
      `nested${sep}deep${sep}file.json`,
    );
    expect(result).toBe(resolve(sandboxRoot, "nested", "deep", "file.json"));
  });

  it("rejects a parent-traversal payload", () => {
    expect(() =>
      resolveWithinWorkspaceSandbox(sandboxRoot, `..${sep}etc${sep}passwd`),
    ).toThrow(WorkspaceSandboxError);
    try {
      resolveWithinWorkspaceSandbox(sandboxRoot, `..${sep}etc${sep}passwd`);
    } catch (err) {
      expect((err as WorkspaceSandboxError).code).toBe("escapes_sandbox");
    }
  });

  it("rejects a payload that climbs past the root via interleaved segments", () => {
    expect(() =>
      resolveWithinWorkspaceSandbox(
        sandboxRoot,
        `nested${sep}..${sep}..${sep}..${sep}etc${sep}shadow`,
      ),
    ).toThrow(/escapes workspace sandbox/);
  });

  it("rejects an absolute path", () => {
    expect(() => resolveWithinWorkspaceSandbox(sandboxRoot, "/etc/passwd")).toThrow(
      WorkspaceSandboxError,
    );
    try {
      resolveWithinWorkspaceSandbox(sandboxRoot, "/etc/passwd");
    } catch (err) {
      expect((err as WorkspaceSandboxError).code).toBe("absolute_path");
    }
  });

  it("rejects an empty path", () => {
    try {
      resolveWithinWorkspaceSandbox(sandboxRoot, "");
      fail("expected error");
    } catch (err) {
      expect((err as WorkspaceSandboxError).code).toBe("missing_path");
    }
  });

  it("rejects an empty sandbox root", () => {
    try {
      resolveWithinWorkspaceSandbox("", "agent-output.txt");
      fail("expected error");
    } catch (err) {
      expect((err as WorkspaceSandboxError).code).toBe("missing_root");
    }
  });

  it("treats a path equal to the root as inside the sandbox", () => {
    const result = resolveWithinWorkspaceSandbox(sandboxRoot, ".");
    expect(result).toBe(resolve(sandboxRoot));
  });
});

describe("isWithinWorkspaceSandbox", () => {
  let sandboxRoot: string;

  beforeAll(() => {
    sandboxRoot = mkdtempSync(join(tmpdir(), "alt-2057-isin-"));
  });

  afterAll(() => {
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  it("returns true for a clean path", () => {
    expect(isWithinWorkspaceSandbox(sandboxRoot, "agent-output.txt")).toBe(true);
  });

  it("returns false for a traversal payload instead of throwing", () => {
    expect(
      isWithinWorkspaceSandbox(sandboxRoot, `..${sep}etc${sep}passwd`),
    ).toBe(false);
  });

  it("returns false for an absolute path instead of throwing", () => {
    expect(isWithinWorkspaceSandbox(sandboxRoot, "/etc/passwd")).toBe(false);
  });
});
