import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  clearStoredActiveWorkspaceId,
  readStoredActiveWorkspaceId,
  withActiveWorkspaceHeader,
  WORKSPACE_STORAGE_EVENT,
  writeStoredActiveWorkspaceId,
} from "./workspaceStorage";

describe("workspaceStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe("readStoredActiveWorkspaceId", () => {
    it("returns null when nothing is stored", () => {
      expect(readStoredActiveWorkspaceId()).toBeNull();
    });

    it("returns the stored workspace id", () => {
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "ws-abc");
      expect(readStoredActiveWorkspaceId()).toBe("ws-abc");
    });

    it("returns null for a whitespace-only value", () => {
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "   ");
      expect(readStoredActiveWorkspaceId()).toBeNull();
    });
  });

  describe("writeStoredActiveWorkspaceId", () => {
    it("persists the workspace id and dispatches a storage event", () => {
      const listener = vi.fn();
      window.addEventListener(WORKSPACE_STORAGE_EVENT, listener);
      writeStoredActiveWorkspaceId("ws-xyz");
      expect(window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBe("ws-xyz");
      expect(listener).toHaveBeenCalledOnce();
      window.removeEventListener(WORKSPACE_STORAGE_EVENT, listener);
    });
  });

  describe("clearStoredActiveWorkspaceId", () => {
    it("removes the stored workspace id and dispatches a storage event", () => {
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "ws-to-clear");
      const listener = vi.fn();
      window.addEventListener(WORKSPACE_STORAGE_EVENT, listener);
      clearStoredActiveWorkspaceId();
      expect(window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)).toBeNull();
      expect(listener).toHaveBeenCalledOnce();
      window.removeEventListener(WORKSPACE_STORAGE_EVENT, listener);
    });
  });

  describe("withActiveWorkspaceHeader", () => {
    beforeEach(() => {
      window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, "ws-123");
    });

    it("returns headers unchanged when no workspace is stored", () => {
      window.localStorage.clear();
      const input = { Authorization: "Bearer tok" };
      expect(withActiveWorkspaceHeader(input)).toBe(input);
    });

    it("returns undefined unchanged when no workspace is stored and no headers given", () => {
      window.localStorage.clear();
      expect(withActiveWorkspaceHeader(undefined)).toBeUndefined();
    });

    it("merges into a plain object", () => {
      const result = withActiveWorkspaceHeader({ Authorization: "Bearer tok" });
      expect(result).toEqual({ Authorization: "Bearer tok", "X-Workspace-Id": "ws-123" });
    });

    it("merges into a Headers instance", () => {
      const input = new Headers({ Authorization: "Bearer tok" });
      const result = withActiveWorkspaceHeader(input) as Headers;
      expect(result).toBeInstanceOf(Headers);
      expect(result.get("X-Workspace-Id")).toBe("ws-123");
      expect(result.get("Authorization")).toBe("Bearer tok");
      // Does not mutate the original
      expect(input.get("X-Workspace-Id")).toBeNull();
    });

    it("appends to an array of header tuples", () => {
      const input: [string, string][] = [["Authorization", "Bearer tok"]];
      const result = withActiveWorkspaceHeader(input) as [string, string][];
      expect(result).toContainEqual(["X-Workspace-Id", "ws-123"]);
      expect(result).toContainEqual(["Authorization", "Bearer tok"]);
      expect(input).toHaveLength(1);
    });

    it("adds the header to an empty plain object when nothing is passed", () => {
      const result = withActiveWorkspaceHeader();
      expect(result).toEqual({ "X-Workspace-Id": "ws-123" });
    });
  });
});
