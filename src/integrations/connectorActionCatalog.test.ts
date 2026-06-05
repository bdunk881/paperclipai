/**
 * HEL-657: connection-gated action catalog (HEL-647 PR 4).
 */

jest.mock("../middleware/workspaceContext", () => ({ withUserContext: jest.fn() }));
jest.mock("../engine/connectorActions", () => ({
  listConnectorActions: jest.fn(() => [
    {
      connectorKey: "slack",
      actionId: "slack.notify",
      label: "Send a Slack notification",
      description: "Post a message",
      isWrite: true,
    },
    {
      connectorKey: "hubspot",
      actionId: "hubspot.upsertContact",
      label: "Upsert HubSpot contact",
      isWrite: true,
    },
  ]),
}));

import { buildConnectorActionCatalog } from "./connectorActionCatalog";
import { withUserContext } from "../middleware/workspaceContext";
import type { Pool } from "pg";

const mockWithUser = withUserContext as jest.MockedFunction<typeof withUserContext>;
const fakePool = {} as Pool;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("buildConnectorActionCatalog (HEL-657)", () => {
  it("flags an action connected when the user has the backing connector", async () => {
    mockWithUser.mockResolvedValue([{ service: "slack" }] as never);

    const actions = await buildConnectorActionCatalog(fakePool, "user-1");

    const slack = actions.find((a) => a.actionId === "slack.notify");
    const hub = actions.find((a) => a.actionId === "hubspot.upsertContact");
    expect(slack).toMatchObject({ connected: true, isWrite: true, label: "Send a Slack notification" });
    expect(slack?.description).toBe("Post a message");
    expect(hub).toMatchObject({ connected: false });
  });

  it("reports all actions disconnected when the user has no connections", async () => {
    mockWithUser.mockResolvedValue([] as never);

    const actions = await buildConnectorActionCatalog(fakePool, "user-1");

    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.connected === false)).toBe(true);
  });

  it("degrades gracefully (no throw, all disconnected) when the lookup fails", async () => {
    mockWithUser.mockRejectedValue(new Error("db down"));

    const actions = await buildConnectorActionCatalog(fakePool, "user-1");

    expect(actions.every((a) => a.connected === false)).toBe(true);
  });

  it("skips the query and reports disconnected when Postgres is unavailable (null pool)", async () => {
    const actions = await buildConnectorActionCatalog(null, "user-1");

    expect(mockWithUser).not.toHaveBeenCalled();
    expect(actions.every((a) => a.connected === false)).toBe(true);
  });
});
