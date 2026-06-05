import { normalizeSesEvent, normalizeTelnyxWebhook } from "./normalize";

describe("normalizeTelnyxWebhook (HEL-613)", () => {
  it("normalizes an inbound SMS, routing by the destination number", () => {
    const event = normalizeTelnyxWebhook({
      data: {
        event_type: "message.received",
        id: "evt-1",
        payload: {
          id: "msg-1",
          direction: "inbound",
          from: { phone_number: "+15551112222" },
          to: [{ phone_number: "+15559998888" }],
          text: "hello there",
        },
      },
    });
    expect(event).not.toBeNull();
    expect(event!.provider).toBe("telnyx");
    expect(event!.kind).toBe("inbound_sms");
    expect(event!.address).toEqual({ channel: "sms", value: "+15559998888" });
    expect(event!.dedupeKey).toBe("telnyx:evt-1");
    expect(event!.summary).toContain("hello there");
  });

  it("normalizes a delivered receipt as a delivery event with the message id", () => {
    const event = normalizeTelnyxWebhook({
      data: {
        event_type: "message.finalized",
        id: "evt-2",
        payload: { id: "msg-2", to: [{ phone_number: "+15551112222", status: "delivered" }] },
      },
    })!;
    expect(event.kind).toBe("delivery");
    expect(event.providerMessageId).toBe("msg-2");
    expect(event.address).toBeUndefined();
  });

  it("normalizes a failed receipt as a bounce", () => {
    const event = normalizeTelnyxWebhook({
      data: {
        event_type: "message.finalized",
        id: "evt-3",
        payload: { id: "msg-3", to: [{ phone_number: "+15551112222", status: "delivery_failed" }] },
      },
    })!;
    expect(event.kind).toBe("bounce");
    expect(event.providerMessageId).toBe("msg-3");
  });

  it("returns null for irrelevant or unparseable bodies", () => {
    expect(normalizeTelnyxWebhook(null)).toBeNull();
    expect(normalizeTelnyxWebhook({})).toBeNull();
    // inbound with no destination number → cannot route
    expect(
      normalizeTelnyxWebhook({
        data: { event_type: "message.received", id: "x", payload: { id: "m" } },
      }),
    ).toBeNull();
  });
});

describe("normalizeSesEvent (HEL-613)", () => {
  it("normalizes a permanent bounce with the workspace tag + message id", () => {
    const event = normalizeSesEvent({
      notificationType: "Bounce",
      mail: { messageId: "ses-1", tags: { workspace_id: ["ws-1"] } },
      bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "a@b.com" }] },
    })!;
    expect(event.kind).toBe("bounce");
    expect(event.provider).toBe("ses");
    expect(event.providerMessageId).toBe("ses-1");
    expect(event.workspaceId).toBe("ws-1");
    expect(event.dedupeKey).toBe("ses:bounce:ses-1");
  });

  it("normalizes a complaint", () => {
    const event = normalizeSesEvent({
      eventType: "Complaint",
      mail: { messageId: "ses-2" },
      complaint: { complainedRecipients: [{ emailAddress: "c@d.com" }] },
    })!;
    expect(event.kind).toBe("complaint");
    expect(event.dedupeKey).toBe("ses:complaint:ses-2");
  });

  it("ignores transient bounces and deliveries", () => {
    expect(
      normalizeSesEvent({
        notificationType: "Bounce",
        mail: { messageId: "ses-3" },
        bounce: { bounceType: "Transient" },
      }),
    ).toBeNull();
    expect(normalizeSesEvent({ notificationType: "Delivery", mail: { messageId: "ses-4" } })).toBeNull();
  });
});
