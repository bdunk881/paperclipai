import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_STORAGE_KEY,
  clearStoredAuthUser,
  readQaPreviewToken,
  readStoredAuthUser,
  sanitizeQaPreviewRedirect,
  writeStoredAuthUser,
} from "./authStorage";

describe("authStorage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("round-trips a stored auth user", () => {
    writeStoredAuthUser({
      id: "usr-qa-preview",
      email: "qa-preview@autoflow.local",
      name: "QA Preview User",
    });

    expect(readStoredAuthUser()).toEqual({
      id: "usr-qa-preview",
      email: "qa-preview@autoflow.local",
      name: "QA Preview User",
    });
  });

  it("returns null for malformed stored values", () => {
    window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ nope: true }));

    expect(readStoredAuthUser()).toBeNull();
  });

  it("accepts a QA preview user seeded with only an id", () => {
    window.sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ id: "qa-smoke-user" }));

    expect(readStoredAuthUser()).toEqual({
      id: "qa-smoke-user",
      email: "",
      name: "qa-smoke-user",
      tenantId: undefined,
    });
  });

  it("clears the stored auth user", () => {
    writeStoredAuthUser({
      id: "usr-qa-preview",
      email: "qa-preview@autoflow.local",
      name: "QA Preview User",
    });

    clearStoredAuthUser();

    expect(readStoredAuthUser()).toBeNull();
  });

  it("reads the QA preview token from search params", () => {
    expect(readQaPreviewToken("?foo=bar&qaPreviewToken=secret-token")).toBe("secret-token");
    expect(readQaPreviewToken("?foo=bar")).toBeNull();
  });

  it("only accepts safe internal redirects", () => {
    expect(sanitizeQaPreviewRedirect("/agents/activity")).toBe("/agents/activity");
    expect(sanitizeQaPreviewRedirect("https://example.com")).toBeNull();
    expect(sanitizeQaPreviewRedirect("//evil.example.com")).toBeNull();
  });
});
