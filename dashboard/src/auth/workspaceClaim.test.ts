import { describe, it, expect } from "vitest";
import { getWorkspaceClaimFromAccessToken } from "./workspaceClaim";

function buildToken(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${encoded}.signature`;
}

describe("getWorkspaceClaimFromAccessToken", () => {
  it("returns null for undefined input", () => {
    expect(getWorkspaceClaimFromAccessToken(undefined)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(getWorkspaceClaimFromAccessToken(null)).toBeNull();
  });

  it("returns null when token has no payload section", () => {
    expect(getWorkspaceClaimFromAccessToken("invalid-token")).toBeNull();
  });

  it("returns null when payload is not valid base64 JSON", () => {
    expect(getWorkspaceClaimFromAccessToken("header.!!!.signature")).toBeNull();
  });

  it("returns null when payload has no workspace claim", () => {
    const token = buildToken({ sub: "user-1", email: "test@example.com" });
    expect(getWorkspaceClaimFromAccessToken(token)).toBeNull();
  });

  it("extracts workspaceId from the canonical key", () => {
    const token = buildToken({ sub: "user-1", workspaceId: "ws-abc" });
    expect(getWorkspaceClaimFromAccessToken(token)).toBe("ws-abc");
  });

  it("extracts workspace_id from the snake_case key", () => {
    const token = buildToken({ sub: "user-1", workspace_id: "ws-snake" });
    expect(getWorkspaceClaimFromAccessToken(token)).toBe("ws-snake");
  });

  it("extracts from the extension_workspaceId key", () => {
    const token = buildToken({ extension_workspaceId: "ws-ext" });
    expect(getWorkspaceClaimFromAccessToken(token)).toBe("ws-ext");
  });

  it("extracts from the extension_workspace_id key", () => {
    const token = buildToken({ extension_workspace_id: "ws-ext-snake" });
    expect(getWorkspaceClaimFromAccessToken(token)).toBe("ws-ext-snake");
  });

  it("extracts from the custom autoflow namespace key", () => {
    const token = buildToken({ "https://autoflow.ai/workspaceId": "ws-ns" });
    expect(getWorkspaceClaimFromAccessToken(token)).toBe("ws-ns");
  });

  it("extracts from the autoflow namespace snake_case key", () => {
    const token = buildToken({ "https://autoflow.ai/workspace_id": "ws-ns-snake" });
    expect(getWorkspaceClaimFromAccessToken(token)).toBe("ws-ns-snake");
  });

  it("trims whitespace from the value", () => {
    const token = buildToken({ workspaceId: "  ws-padded  " });
    expect(getWorkspaceClaimFromAccessToken(token)).toBe("ws-padded");
  });

  it("skips empty-string workspace values in canonical keys", () => {
    const token = buildToken({ workspaceId: "   ", workspace_id: "ws-fallback" });
    expect(getWorkspaceClaimFromAccessToken(token)).toBe("ws-fallback");
  });

  it("falls back to a dynamic key ending in workspaceId", () => {
    const token = buildToken({ "x-custom-workspaceId": "ws-dynamic" });
    expect(getWorkspaceClaimFromAccessToken(token)).toBe("ws-dynamic");
  });

  it("falls back to a dynamic key ending in workspace_id", () => {
    const token = buildToken({ "x-custom-workspace_id": "ws-dynamic-snake" });
    expect(getWorkspaceClaimFromAccessToken(token)).toBe("ws-dynamic-snake");
  });

  it("returns null for non-string workspace values", () => {
    const token = buildToken({ workspaceId: 123 });
    expect(getWorkspaceClaimFromAccessToken(token)).toBeNull();
  });
});
