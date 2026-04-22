import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendAgentActivity,
  createDeployment,
  getAgentTemplate,
  listAgentActivity,
  listAgentTemplates,
  listDeployments,
  saveAgentActivity,
  saveDeployments,
} from "./agentMarketplaceData";

describe("agentMarketplaceData", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          store.set(key, value);
        }),
      },
    });
    vi.spyOn(Date, "now").mockReturnValue(1_714_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.123);
  });

  it("returns the static template list and null for unknown templates", () => {
    expect(listAgentTemplates()).toEqual([]);
    expect(getAgentTemplate("missing-template")).toBeNull();
  });

  it("initializes deployment storage when missing and reads saved deployments", () => {
    expect(listDeployments()).toEqual([]);
    expect(window.localStorage.getItem("autoflow:agent-deployments")).toBe("[]");

    const deployments = [
      {
        id: "dep_1",
        templateId: "tpl_1",
        templateName: "Support Agent",
        name: "Support Agent Instance",
        status: "running",
        permissions: ["read"],
        integrations: ["GitHub"],
        deployedAt: "2026-04-22T00:00:00.000Z",
        lastActiveAt: "2026-04-22T00:00:00.000Z",
        tokenUsage24h: 1234,
      },
    ];

    saveDeployments(deployments);

    expect(listDeployments()).toEqual(deployments);
  });

  it("falls back when stored deployment or activity JSON is invalid", () => {
    window.localStorage.setItem("autoflow:agent-deployments", "{bad-json");
    window.localStorage.setItem("autoflow:agent-activity", "{bad-json");

    expect(listDeployments()).toEqual([]);
    expect(listAgentActivity()).toEqual([]);
  });

  it("initializes activity storage, saves activity, and prepends appended entries", () => {
    expect(listAgentActivity()).toEqual([]);
    expect(window.localStorage.getItem("autoflow:agent-activity")).toBe("[]");

    saveAgentActivity([
      {
        id: "act_existing",
        agentName: "Ops Agent",
        action: "Heartbeat completed",
        status: "info",
        tokenUsage: 25,
        createdAt: "2026-04-21T00:00:00.000Z",
        summary: "Existing summary",
      },
    ]);

    appendAgentActivity({
      agentName: "Support Agent",
      action: "Deployment completed",
      status: "success",
      tokenUsage: 420,
      summary: "Support Agent deployed",
    });

    const activity = listAgentActivity();
    expect(activity).toHaveLength(2);
    expect(activity[0]).toMatchObject({
      id: "act_1714000000000_123",
      agentName: "Support Agent",
      action: "Deployment completed",
      status: "success",
      tokenUsage: 420,
      createdAt: expect.any(String),
      summary: "Support Agent deployed",
    });
    expect(activity[1].id).toBe("act_existing");
  });

  it("creates a deployment and records matching activity", () => {
    const deployment = createDeployment({
      template: {
        id: "tpl_support",
        name: "Support Agent",
        category: "Support",
        description: "Handles inbound support work",
        capabilities: ["Triage tickets"],
        requiredIntegrations: ["GitHub"],
        optionalIntegrations: ["Notion"],
        pricingTier: "Growth",
        monthlyPriceUsd: 299,
      },
      name: "Support Agent Instance",
      permissions: ["read", "execute"],
      integrations: ["GitHub", "Notion"],
    });

    expect(deployment).toMatchObject({
      id: "dep_1714000000000_123",
      templateId: "tpl_support",
      templateName: "Support Agent",
      name: "Support Agent Instance",
      status: "running",
      permissions: ["read", "execute"],
      integrations: ["GitHub", "Notion"],
      deployedAt: expect.any(String),
      lastActiveAt: expect.any(String),
      tokenUsage24h: 1515,
    });

    expect(listDeployments()[0]).toEqual(deployment);
    expect(listAgentActivity()[0]).toMatchObject({
      agentName: "Support Agent Instance",
      action: "Deployment completed",
      status: "success",
      tokenUsage: 420,
      summary: "Support Agent deployed with 2 integrations connected.",
    });
  });
});
