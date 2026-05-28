import { notificationService } from "./service";
import { notificationStore } from "./store";
import { integrationCredentialStore } from "../integrations/integrationCredentialStore";
import { slackCredentialStore } from "../integrations/slack/credentialStore";

const TEST_WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEST_USER_ID = "user-1";

describe("notification system", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    await notificationStore.clear();
    integrationCredentialStore.clear();
    slackCredentialStore.clear();
  });

  it("lists default workspace preferences and persists updates", async () => {
    const initial = await notificationService.listPreferences(TEST_WORKSPACE_ID, TEST_USER_ID);
    expect(initial).toHaveLength(15);

    const updated = await notificationService.updatePreference({
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      channel: "email",
      kind: "milestones",
      cadence: "daily",
      enabled: true,
    });

    expect(updated.cadence).toBe("daily");
  });

  it("sends an immediate Slack notification for a configured workspace", async () => {
    await slackCredentialStore.saveApiKey({
      userId: TEST_USER_ID,
      botToken: "xoxb-slack-token",
      teamId: "T123",
      teamName: "AutoFlow",
    });

    const [slackConnection] = await slackCredentialStore.getPublicByUserAsync(TEST_USER_ID);
    await notificationService.upsertTransportConfig({
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      channel: "slack",
      ownerUserId: TEST_USER_ID,
      connectionId: slackConnection?.id,
      enabled: true,
      config: { slackChannelId: "C-alerts", slackChannelName: "alerts" },
    });
    await notificationService.updatePreference({
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      channel: "slack",
      kind: "kill_switch",
      cadence: "immediate",
      enabled: true,
    });

    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: "123", channel: "C-alerts" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await notificationService.recordEvent({
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      kind: "kill_switch",
      title: "Kill switch triggered",
      summary: "All outbound runs paused.",
      severity: "critical",
    });
    const result = await notificationService.runSweepForWorkspace(TEST_WORKSPACE_ID, TEST_USER_ID);

    expect(result.delivered).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
  });
});
