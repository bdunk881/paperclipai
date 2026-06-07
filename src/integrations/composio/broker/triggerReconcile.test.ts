import { reconcileWorkspaceTriggers } from "./triggerReconcile";
import { getComposioBroker } from "./client";
import { triggerInstanceStore, type ComposioWorkspaceContext } from "./triggerInstanceStore";

jest.mock("./client", () => ({ getComposioBroker: jest.fn() }));
const mockGetBroker = getComposioBroker as jest.MockedFunction<typeof getComposioBroker>;

const ctxA: ComposioWorkspaceContext = { workspaceId: "ws-A", userId: "user-A" };

function mockListActive(items: { id: string }[], nextCursor: string | null = null) {
  const listActive = jest.fn().mockResolvedValue({ items, nextCursor });
  mockGetBroker.mockResolvedValue({ triggers: { listActive } } as never);
  return listActive;
}

async function seed(triggerId: string, status: "ENABLED" | "DISABLED" = "ENABLED") {
  await triggerInstanceStore.create(ctxA, {
    agentId: "agent-1",
    toolkit: "github",
    triggerSlug: "GITHUB_COMMIT_EVENT",
    triggerId,
    connectedAccountId: "ca_1",
    status,
  });
}

const ORIGINAL_ENV = { ...process.env };

describe("reconcileWorkspaceTriggers (HEL-769 / P4-e)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, COMPOSIO_ENABLED: "true", COMPOSIO_API_KEY: "ck_test" };
    triggerInstanceStore.__resetForTests();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("marks a local ENABLED trigger that is no longer active remotely as ERROR", async () => {
    await seed("ti_1");
    await seed("ti_2");
    mockListActive([{ id: "ti_1" }]); // ti_2 absent remotely → drifted

    const res = await reconcileWorkspaceTriggers(ctxA);

    expect(res.checked).toBe(2);
    expect(res.drifted).toEqual(["ti_2"]);
    await expect(triggerInstanceStore.findByTriggerId("ti_1")).resolves.toMatchObject({ status: "ENABLED" });
    await expect(triggerInstanceStore.findByTriggerId("ti_2")).resolves.toMatchObject({ status: "ERROR" });
  });

  it("scopes the remote query to the workspace's trigger ids", async () => {
    await seed("ti_1");
    const listActive = mockListActive([{ id: "ti_1" }]);

    await reconcileWorkspaceTriggers(ctxA);

    expect(listActive).toHaveBeenCalledWith(
      expect.objectContaining({ triggerIds: ["ti_1"], showDisabled: false }),
    );
  });

  it("no-ops when there are no ENABLED triggers", async () => {
    await seed("ti_d", "DISABLED");
    const listActive = mockListActive([]);

    const res = await reconcileWorkspaceTriggers(ctxA);

    expect(res).toEqual({ checked: 0, drifted: [] });
    expect(listActive).not.toHaveBeenCalled();
  });

  it("is best-effort — a broker error marks nothing", async () => {
    await seed("ti_1");
    mockGetBroker.mockResolvedValue({
      triggers: { listActive: jest.fn().mockRejectedValue(new Error("broker down")) },
    } as never);

    const res = await reconcileWorkspaceTriggers(ctxA);

    expect(res).toEqual({ checked: 1, drifted: [] });
    await expect(triggerInstanceStore.findByTriggerId("ti_1")).resolves.toMatchObject({ status: "ENABLED" });
  });

  it("returns empty when Composio is disabled", async () => {
    delete process.env.COMPOSIO_API_KEY;
    await seed("ti_1");
    await expect(reconcileWorkspaceTriggers(ctxA)).resolves.toEqual({ checked: 0, drifted: [] });
    expect(mockGetBroker).not.toHaveBeenCalled();
  });
});
