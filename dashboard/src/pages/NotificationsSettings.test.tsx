import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NotificationsSettings from "./NotificationsSettings";

const WORKSPACE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const requireAccessToken = vi.fn(
  async () =>
    `header.${btoa(JSON.stringify({ workspaceId: WORKSPACE_ID }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "")}.signature`,
);
const authValue = {
  user: { id: "user-1", email: "user@example.com", name: "User One" },
  requireAccessToken,
};

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authValue,
}));

describe("NotificationsSettings", () => {
  it("renders the notification controls from the backend API", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/notifications/preferences")) {
        expect(url).toBe("/api/notifications/preferences");
        if (init?.body) {
          expect(JSON.parse(String(init.body))).not.toHaveProperty("workspaceId");
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              preferences: [
                {
                  id: "pref-1",
                  workspaceId: WORKSPACE_ID,
                  channel: "slack",
                  kind: "approvals",
                  cadence: "daily",
                  enabled: true,
                },
                {
                  id: "pref-2",
                  workspaceId: WORKSPACE_ID,
                  channel: "email",
                  kind: "kill_switch",
                  cadence: "immediate",
                  enabled: true,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/notifications/transports")) {
        expect(url).toBe("/api/notifications/transports");
        if (init?.body) {
          expect(JSON.parse(String(init.body))).not.toHaveProperty("workspaceId");
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              transports: [
                {
                  id: "transport-1",
                  workspaceId: WORKSPACE_ID,
                  channel: "slack",
                  ownerUserId: "user-1",
                  connectionId: "slack-1",
                  enabled: true,
                  config: { slackChannelId: "C123", slackChannelName: "ops-alerts" },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/integrations/slack/connections")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ connections: [{ id: "slack-1", teamName: "AutoFlow", teamId: "T123" }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/integrations/connections?integration=sendgrid")) {
        return Promise.resolve(
          new Response(JSON.stringify({ connections: [{ id: "sendgrid-1", label: "Primary SendGrid" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.includes("/api/integrations/connections?integration=twilio")) {
        return Promise.resolve(
          new Response(JSON.stringify({ connections: [{ id: "twilio-1", label: "Twilio Prod" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`Unhandled fetch URL: ${url}`));
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationsSettings />);

    await waitFor(() => {
      expect(screen.getByText("Notifications")).toBeInTheDocument();
      expect(screen.getByText("Channel transports")).toBeInTheDocument();
      expect(screen.getByText("Cadence by notification type")).toBeInTheDocument();
      expect(screen.getAllByText("Slack").length).toBeGreaterThan(0);
      expect(screen.getByText("Approvals")).toBeInTheDocument();
      expect(screen.getByText("Kill switch")).toBeInTheDocument();
      expect(screen.getByDisplayValue("ops-alerts")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalled();
  });
});
