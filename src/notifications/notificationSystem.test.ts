import { notificationService } from "./service";
import { notificationStore } from "./store";
import { integrationCredentialStore } from "../integrations/integrationCredentialStore";
import { slackCredentialStore } from "../integrations/slack/credentialStore";

describe("notification system", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    await notificationStore.clear();
    integrationCredentialStore.clear();
    slackCredentialStore.clear();
  });

  it("lists default workspace preferences and persists updates", async () => {
    const initial = await notificationService.listPreferences("11111111-1111-4111-8111-111111111111");
    expect(initial).toHaveLength(15);

    const updated = await notificationService.updatePreference({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      channel: "email",
      kind: "milestones",
      cadence: "daily",
      enabled: true,
    });

    expect(updated.cadence).toBe("daily");
  });

  it("sends an immediate Slack notification for a configured workspace", async () => {
    slackCredentialStore.saveApiKey({
      userId: "user-1",
      botToken: "xoxb-slack-token",
      teamId: "T123",
      teamName: "AutoFlow",
    });

    const [slackConnection] = slackCredentialStore.getPublicByUser("user-1");
    await notificationService.upsertTransportConfig({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      channel: "slack",
      ownerUserId: "user-1",
      connectionId: slackConnection?.id,
      enabled: true,
      config: { slackChannelId: "C-alerts", slackChannelName: "alerts" },
    });
    await notificationService.updatePreference({
      workspaceId: "11111111-1111-4111-8111-111111111111",
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
      workspaceId: "11111111-1111-4111-8111-111111111111",
      kind: "kill_switch",
      title: "Kill switch triggered",
      summary: "All outbound runs paused.",
      severity: "critical",
    });
    const result = await notificationService.runSweepForWorkspace("11111111-1111-4111-8111-111111111111");

    expect(result.delivered).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
  });
});
