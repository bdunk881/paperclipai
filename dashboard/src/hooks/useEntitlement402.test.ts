import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EntitlementError } from "../api/entitlementError";
import { useEntitlement402 } from "./useEntitlement402";

describe("useEntitlement402", () => {
  const { result } = renderHook(() => useEntitlement402());

  describe("parse", () => {
    it("returns null for non-entitlement errors", () => {
      expect(result.current.parse(new Error("generic"))).toBeNull();
      expect(result.current.parse("string error")).toBeNull();
      expect(result.current.parse(null)).toBeNull();
    });

    it("returns upgrade state for an EntitlementError with upgradeTo set", () => {
      const err = new EntitlementError({
        code: "entitlement_exceeded",
        feature: "llm_configs",
        limit: 3,
        current: 3,
        currentTier: "starter",
        upgradeTo: "scale",
      });
      const state = result.current.parse(err);
      expect(state).not.toBeNull();
      expect(state?.feature).toBe("llm_configs");
      expect(state?.currentTier).toBe("starter");
      expect(state?.upgradeTo).toBe("scale");
      expect(state?.limit).toBe(3);
      expect(state?.current).toBe(3);
    });

    it("returns upgrade state for an EntitlementError with upgradeTo null", () => {
      const err = new EntitlementError({
        code: "entitlement_exceeded",
        feature: "agents",
        limit: false,
        currentTier: "enterprise",
        upgradeTo: null,
      });
      const state = result.current.parse(err);
      expect(state).not.toBeNull();
      expect(state?.upgradeTo).toBeNull();
    });
  });

  describe("openUpgrade", () => {
    let originalLocation: Location;

    beforeEach(() => {
      originalLocation = window.location;
    });

    afterEach(() => {
      Object.defineProperty(window, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    });

    it("navigates to the pricing page when upgradeTo is set", () => {
      const captured: string[] = [];
      Object.defineProperty(window, "location", {
        value: {
          get href() {
            return captured[captured.length - 1] ?? "";
          },
          set href(v: string) {
            captured.push(v);
          },
        },
        writable: true,
        configurable: true,
      });

      const err = new EntitlementError({
        code: "entitlement_exceeded",
        feature: "agents",
        limit: 1,
        currentTier: "starter",
        upgradeTo: "flow",
      });
      result.current.parse(err)!.openUpgrade();
      expect(captured).toContain("/pricing?tier=flow");
    });

    it("navigates to the sales mailto when upgradeTo is null", () => {
      const captured: string[] = [];
      Object.defineProperty(window, "location", {
        value: {
          get href() {
            return captured[captured.length - 1] ?? "";
          },
          set href(v: string) {
            captured.push(v);
          },
        },
        writable: true,
        configurable: true,
      });

      const err = new EntitlementError({
        code: "entitlement_exceeded",
        feature: "seats",
        limit: false,
        currentTier: "enterprise",
        upgradeTo: null,
      });
      result.current.parse(err)!.openUpgrade();
      expect(captured).toContain(
        "mailto:sales@helloautoflow.com?subject=AutoFlow%20Scale%20Plan",
      );
    });
  });
});
