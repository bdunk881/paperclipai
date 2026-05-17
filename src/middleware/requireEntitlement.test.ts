import type { NextFunction, Response } from "express";
import type { WorkspaceAwareRequest } from "./workspaceResolver";
import { requireEntitlement } from "./requireEntitlement";
import { entitlementStore } from "../billing/entitlements";

function createResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json } as unknown as Response;
}

function reqInWorkspace(workspaceId: string): WorkspaceAwareRequest {
  return {
    auth: { sub: "user-1" },
    workspaceId,
    workspace: { id: workspaceId, role: "admin" },
  } as unknown as WorkspaceAwareRequest;
}

describe("requireEntitlement", () => {
  beforeEach(() => {
    entitlementStore.clear();
  });

  describe("boolean features (byokAllowed)", () => {
    it("allows on a plan that grants the feature (automate)", async () => {
      const ws = "ws-automate";
      entitlementStore.upsert(ws, "automate"); // byokAllowed=true on automate
      const middleware = requireEntitlement("byokAllowed");
      const req = reqInWorkspace(ws);
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("denies with 402 + structured upgrade hint on a plan that doesn't grant the feature (flow)", async () => {
      const ws = "ws-flow";
      entitlementStore.upsert(ws, "flow"); // byokAllowed=false on flow
      const middleware = requireEntitlement("byokAllowed");
      const req = reqInWorkspace(ws);
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "entitlement_exceeded",
          feature: "byokAllowed",
          currentTier: "flow",
          upgradeTo: "automate",
        }),
      );
    });

    it("upgradeTo is null when denying at the top of the plan ladder (scale)", async () => {
      // Scale's agentCap is 50. To exercise the upgradeTo=null branch we
      // need the deny path on a scale workspace — set current=50 with
      // delta=1 so the quota check fails.
      const ws = "ws-scale-cap";
      entitlementStore.upsert(ws, "scale");
      const middleware = requireEntitlement("agentCap", {
        getCurrent: () => 50,
        delta: 1,
      });
      const req = reqInWorkspace(ws);
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          currentTier: "scale",
          upgradeTo: null,
        }),
      );
    });
  });

  describe("quota features without getCurrent", () => {
    it("passes when the limit is > 0 (feature available under the plan)", async () => {
      const ws = "ws-flow-2";
      entitlementStore.upsert(ws, "flow"); // agentCap=3 on flow
      const middleware = requireEntitlement("agentCap");
      const req = reqInWorkspace(ws);
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("quota features with getCurrent", () => {
    it("passes when current + delta <= limit", async () => {
      const ws = "ws-flow-3";
      entitlementStore.upsert(ws, "flow"); // agentCap=3
      const middleware = requireEntitlement("agentCap", {
        getCurrent: () => 2, // already 2 agents
        delta: 1, // creating 1 more
      });
      const req = reqInWorkspace(ws);
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it("denies with 402 + current count when current + delta > limit", async () => {
      const ws = "ws-flow-4";
      entitlementStore.upsert(ws, "flow"); // agentCap=3
      const middleware = requireEntitlement("agentCap", {
        getCurrent: () => 3,
        delta: 1,
      });
      const req = reqInWorkspace(ws);
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "entitlement_exceeded",
          feature: "agentCap",
          limit: 3,
          current: 3,
          currentTier: "flow",
          upgradeTo: "automate",
        }),
      );
    });

    it("supports async getCurrent", async () => {
      const ws = "ws-async";
      entitlementStore.upsert(ws, "automate"); // agentCap=10
      const middleware = requireEntitlement("agentCap", {
        getCurrent: async () => 9,
        delta: 1,
      });
      const req = reqInWorkspace(ws);
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it("returns 500 when getCurrent throws", async () => {
      const ws = "ws-throw";
      entitlementStore.upsert(ws, "flow");
      const middleware = requireEntitlement("agentCap", {
        getCurrent: () => {
          throw new Error("boom");
        },
      });
      const req = reqInWorkspace(ws);
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("default-to-explore safety", () => {
    it("treats a workspace with no stored entitlements as the explore tier (no paid grant beyond explore's own grants)", async () => {
      const ws = "ws-unknown"; // never upserted
      // Explore now grants byokAllowed=true while the hosted free-model
      // path is built; assert the safety property against approvalTierMax
      // (still 0 on explore) so the test continues to verify "default
      // to explore, no paid grant" without dragging in tier-specific
      // BYOK policy.
      const middleware = requireEntitlement("approvalTierMax", {
        getCurrent: () => 1,
      });
      const req = reqInWorkspace(ws);
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          currentTier: "explore",
        }),
      );
    });
  });

  describe("misconfiguration safety", () => {
    it("fails closed with 500 when withWorkspace did not run upstream", async () => {
      const middleware = requireEntitlement("byokAllowed");
      const req = { auth: { sub: "u" } } as unknown as WorkspaceAwareRequest;
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
