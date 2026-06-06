import {
  enableTrigger,
  disableTrigger,
  deleteTrigger,
  getTriggerType,
  listTriggerTypes,
} from "./triggerSubscriptionService";
import { getComposioBroker } from "./client";
import { connectedAccountStore, type ComposioWorkspaceContext } from "./connectedAccountStore";
import { triggerInstanceStore } from "./triggerInstanceStore";

jest.mock("./client", () => ({ getComposioBroker: jest.fn() }));
const mockGetBroker = getComposioBroker as jest.MockedFunction<typeof getComposioBroker>;

const ctxA: ComposioWorkspaceContext = { workspaceId: "ws-A", userId: "user-A" };

function fakeTriggers(over: Record<string, unknown> = {}) {
  return {
    create: jest.fn().mockResolvedValue({ triggerId: "ti_1" }),
    enable: jest.fn().mockResolvedValue({}),
    disable: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    getType: jest.fn().mockResolvedValue({
      slug: "GITHUB_COMMIT_EVENT",
      name: "Commit",
      description: "On commit",
      toolkit: { slug: "github", name: "GitHub", logo: "x" },
      config: { properties: { repo: {} } },
      payload: { properties: { sha: {} } },
    }),
    listTypes: jest.fn().mockResolvedValue({
      items: [
        {
          slug: "GITHUB_COMMIT_EVENT",
          name: "Commit",
          description: "On commit",
          toolkit: { slug: "github", name: "GitHub", logo: "x" },
          config: { ignored: true },
        },
      ],
    }),
    ...over,
  };
}

function mockBroker(triggers: ReturnType<typeof fakeTriggers>) {
  mockGetBroker.mockResolvedValue({ triggers } as never);
  return triggers;
}

const ORIGINAL_ENV = { ...process.env };

async function seedActiveGithub() {
  await connectedAccountStore.upsert(ctxA, {
    toolkit: "github",
    connectedAccountId: "ca_1",
    authConfigId: "ac_1",
    status: "ACTIVE",
  });
}

describe("triggerSubscriptionService (HEL-765 / P4-a)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, COMPOSIO_ENABLED: "true", COMPOSIO_API_KEY: "ck_test" };
    connectedAccountStore.__resetForTests();
    triggerInstanceStore.__resetForTests();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("enableTrigger subscribes against the active connection + persists the binding", async () => {
    await seedActiveGithub();
    const triggers = mockBroker(fakeTriggers());

    const row = await enableTrigger({
      workspaceId: "ws-A",
      userId: "user-A",
      agentId: "agent-1",
      toolkit: "github",
      slug: "GITHUB_COMMIT_EVENT",
      triggerConfig: { repo: "a/b" },
    });

    expect(triggers.create).toHaveBeenCalledWith("ws_ws-A", "GITHUB_COMMIT_EVENT", {
      connectedAccountId: "ca_1",
      triggerConfig: { repo: "a/b" },
    });
    expect(row).toMatchObject({ triggerId: "ti_1", agentId: "agent-1", status: "ENABLED", connectedAccountId: "ca_1" });
    await expect(triggerInstanceStore.findByTriggerId("ti_1")).resolves.toMatchObject({ workspaceId: "ws-A" });
  });

  it("enableTrigger throws when the toolkit has no active connection", async () => {
    mockBroker(fakeTriggers());
    await expect(
      enableTrigger({ workspaceId: "ws-A", userId: "user-A", agentId: "agent-1", toolkit: "github", slug: "S" }),
    ).rejects.toThrow(/no active github connection/i);
  });

  it("disableTrigger calls the SDK + marks the row DISABLED", async () => {
    await seedActiveGithub();
    const triggers = mockBroker(fakeTriggers());
    await enableTrigger({ workspaceId: "ws-A", userId: "user-A", agentId: "agent-1", toolkit: "github", slug: "GITHUB_COMMIT_EVENT" });

    await expect(disableTrigger(ctxA, "ti_1")).resolves.toBe(true);
    expect(triggers.disable).toHaveBeenCalledWith("ti_1");
    await expect(triggerInstanceStore.findByTriggerId("ti_1")).resolves.toMatchObject({ status: "DISABLED" });
  });

  it("deleteTrigger drops the local row even if the remote delete throws (best-effort)", async () => {
    await seedActiveGithub();
    const triggers = mockBroker(fakeTriggers({ delete: jest.fn().mockRejectedValue(new Error("404")) }));
    await enableTrigger({ workspaceId: "ws-A", userId: "user-A", agentId: "agent-1", toolkit: "github", slug: "GITHUB_COMMIT_EVENT" });

    await expect(deleteTrigger(ctxA, "ti_1")).resolves.toBe(true);
    expect(triggers.delete).toHaveBeenCalledWith("ti_1");
    await expect(triggerInstanceStore.findByTriggerId("ti_1")).resolves.toBeNull();
  });

  it("getTriggerType maps config + payload; listTriggerTypes maps the toolkit's types", async () => {
    mockBroker(fakeTriggers());

    const t = await getTriggerType("GITHUB_COMMIT_EVENT");
    expect(t).toMatchObject({
      slug: "GITHUB_COMMIT_EVENT",
      config: { properties: { repo: {} } },
      payload: { properties: { sha: {} } },
      toolkit: { slug: "github" },
    });

    const list = await listTriggerTypes("github");
    expect(list).toEqual([
      {
        slug: "GITHUB_COMMIT_EVENT",
        name: "Commit",
        description: "On commit",
        toolkit: { slug: "github", name: "GitHub", logo: "x" },
      },
    ]);
  });

  it("is inert when Composio is disabled", async () => {
    delete process.env.COMPOSIO_API_KEY;
    await expect(
      enableTrigger({ workspaceId: "ws-A", userId: "user-A", agentId: "a", toolkit: "github", slug: "S" }),
    ).rejects.toThrow(/not enabled/i);
    await expect(listTriggerTypes("github")).resolves.toEqual([]);
    expect(mockGetBroker).not.toHaveBeenCalled();
  });
});
