import {
  createComposioTriggerIngest,
  type NormalizedComposioTriggerEvent,
} from "./composioTriggerIngest";
import { routeEvent } from "../../../agents/eventRouter";
import { findWakeEventByDedupeKey } from "../../../agents/wakeEventStore";

jest.mock("../../../agents/eventRouter", () => ({ routeEvent: jest.fn() }));
jest.mock("../../../agents/wakeEventStore", () => ({ findWakeEventByDedupeKey: jest.fn() }));
jest.mock("../../../agents/wakeDispatch", () => ({ createWakeActDispatcher: jest.fn(() => jest.fn()) }));

const mockRoute = routeEvent as jest.MockedFunction<typeof routeEvent>;
const mockFindDedupe = findWakeEventByDedupeKey as jest.MockedFunction<typeof findWakeEventByDedupeKey>;

const fakePool = {} as never;
const enabledInstance = { workspaceId: "ws-A", agentId: "agent-1", status: "ENABLED" };
const event: NormalizedComposioTriggerEvent = {
  workspaceId: "ws-A",
  triggerSlug: "GITHUB_COMMIT_EVENT",
  connectedAccountId: "ca_1",
  eventId: "evt_1",
  payload: { sha: "abc" },
};

function ingestWith(over: Record<string, unknown> = {}) {
  return createComposioTriggerIngest({
    pool: fakePool,
    resolveInstance: jest.fn().mockResolvedValue(enabledInstance),
    resolveActorUserId: jest.fn().mockResolvedValue("owner-1"),
    ...over,
  });
}

describe("createComposioTriggerIngest (HEL-766 / P4-b)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindDedupe.mockResolvedValue(null);
  });

  it("routes a fired trigger into the wake engine as source=composio_trigger", async () => {
    mockRoute.mockResolvedValue({ id: "we_1", decision: "ACT" } as never);

    const res = await ingestWith()(event);

    expect(res).toEqual({ status: "ok", wakeEventId: "we_1", decision: "ACT" });
    expect(mockRoute).toHaveBeenCalledTimes(1);
    const args = mockRoute.mock.calls[0][1];
    expect(args).toMatchObject({
      workspaceId: "ws-A",
      userId: "owner-1",
      candidateAgentId: "agent-1",
      source: "composio_trigger",
      sourceRef: "composio",
      dedupeKey: "evt_1",
      payload: { sha: "abc", triggerSlug: "GITHUB_COMMIT_EVENT", connectedAccountId: "ca_1" },
    });
  });

  it("is unrouted when the trigger instance is unknown", async () => {
    await expect(ingestWith({ resolveInstance: jest.fn().mockResolvedValue(null) })(event)).resolves.toEqual({
      status: "unrouted",
    });
    expect(mockRoute).not.toHaveBeenCalled();
  });

  it("is unrouted when the instance is DISABLED", async () => {
    const ingest = ingestWith({
      resolveInstance: jest.fn().mockResolvedValue({ ...enabledInstance, status: "DISABLED" }),
    });
    await expect(ingest(event)).resolves.toEqual({ status: "unrouted" });
  });

  it("is unrouted on a workspace mismatch (the event userId must agree with the binding)", async () => {
    const ingest = ingestWith({
      resolveInstance: jest.fn().mockResolvedValue({ ...enabledInstance, workspaceId: "ws-OTHER" }),
    });
    await expect(ingest(event)).resolves.toEqual({ status: "unrouted" });
    expect(mockRoute).not.toHaveBeenCalled();
  });

  it("is unrouted when no workspace member can be resolved (RLS actor)", async () => {
    const ingest = ingestWith({ resolveActorUserId: jest.fn().mockResolvedValue(null) });
    await expect(ingest(event)).resolves.toEqual({ status: "unrouted" });
    expect(mockRoute).not.toHaveBeenCalled();
  });

  it("short-circuits a provider retry (duplicate dedupeKey)", async () => {
    mockFindDedupe.mockResolvedValue({ id: "we_prev", decision: "ACT" } as never);
    await expect(ingestWith()(event)).resolves.toEqual({
      status: "duplicate",
      wakeEventId: "we_prev",
      decision: "ACT",
    });
    expect(mockRoute).not.toHaveBeenCalled();
  });
});
