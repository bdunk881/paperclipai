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
    const initial = await notificationService.listPreferences("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(initial).toHaveLength(15);

    const updated = await notificationService.updatePreference({
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      channel: "slack",
      ownerUserId: "user-1",
      connectionId: slackConnection?.id,
      enabled: true,
      config: { slackChannelId: "C-alerts", slackChannelName: "alerts" },
    });
    await notificationService.updatePreference({
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "kill_switch",
      title: "Kill switch triggered",
      summary: "All outbound runs paused.",
      severity: "critical",
    });
    const result = await notificationService.runSweepForWorkspace("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    expect(result.delivered).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
  });
});
