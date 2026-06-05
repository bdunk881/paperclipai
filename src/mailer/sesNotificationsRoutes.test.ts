import express from "express";
import request from "supertest";
import { createSesNotificationsRoutes, SesNotificationsDeps } from "./sesNotificationsRoutes";

const WS = "11111111-1111-1111-1111-111111111111";

function appWith(deps: SesNotificationsDeps) {
  const app = express();
  app.use("/api/webhooks/ses-notifications", createSesNotificationsRoutes(deps));
  return app;
}

describe("SES notifications webhook", () => {
  it("confirms a subscription by visiting the SubscribeURL", async () => {
    const fetched: string[] = [];
    const app = appWith({
      verify: async () => true,
      fetchFn: (async (url: string) => {
        fetched.push(String(url));
        return { ok: true } as Response;
      }) as unknown as typeof fetch,
      suppress: async () => undefined,
    });

    const res = await request(app)
      .post("/api/webhooks/ses-notifications")
      .send({
        Type: "SubscriptionConfirmation",
        SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc",
      });

    expect(res.status).toBe(200);
    expect(fetched).toHaveLength(1);
  });

  it("suppresses recipients of a permanent bounce (workspace-scoped via tags)", async () => {
    const calls: unknown[] = [];
    const app = appWith({ verify: async () => true, suppress: async (i) => void calls.push(i) });
    const event = JSON.stringify({
      notificationType: "Bounce",
      bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "bounce@example.com" }] },
      mail: { messageId: "m1", tags: { workspace_id: [WS] } },
    });

    const res = await request(app)
      .post("/api/webhooks/ses-notifications")
      .send({ Type: "Notification", Message: event });

    expect(res.status).toBe(200);
    expect(calls).toEqual([
      { workspaceId: WS, email: "bounce@example.com", reason: "bounce", source: "m1" },
    ]);
  });

  it("suppresses complaint recipients globally when there's no workspace tag", async () => {
    const calls: unknown[] = [];
    const app = appWith({ verify: async () => true, suppress: async (i) => void calls.push(i) });
    const event = JSON.stringify({
      notificationType: "Complaint",
      complaint: { complainedRecipients: [{ emailAddress: "c@example.com" }] },
      mail: { messageId: "m2" },
    });

    const res = await request(app)
      .post("/api/webhooks/ses-notifications")
      .send({ Type: "Notification", Message: event });

    expect(res.status).toBe(200);
    expect(calls).toEqual([
      { workspaceId: null, email: "c@example.com", reason: "complaint", source: "m2" },
    ]);
  });

  it("does not suppress on delivery or a transient bounce", async () => {
    const calls: unknown[] = [];
    const app = appWith({ verify: async () => true, suppress: async (i) => void calls.push(i) });
    const delivery = JSON.stringify({ notificationType: "Delivery", mail: { messageId: "m3" } });
    const transient = JSON.stringify({
      notificationType: "Bounce",
      bounce: { bounceType: "Transient", bouncedRecipients: [{ emailAddress: "t@example.com" }] },
      mail: {},
    });

    await request(app).post("/api/webhooks/ses-notifications").send({ Type: "Notification", Message: delivery });
    await request(app).post("/api/webhooks/ses-notifications").send({ Type: "Notification", Message: transient });

    expect(calls).toHaveLength(0);
  });

  it("rejects a forged (bad-signature) message with 403 and does not suppress", async () => {
    const calls: unknown[] = [];
    const app = appWith({ verify: async () => false, suppress: async (i) => void calls.push(i) });
    const event = JSON.stringify({
      notificationType: "Complaint",
      complaint: { complainedRecipients: [{ emailAddress: "x@example.com" }] },
    });

    const res = await request(app)
      .post("/api/webhooks/ses-notifications")
      .send({ Type: "Notification", Message: event });

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
