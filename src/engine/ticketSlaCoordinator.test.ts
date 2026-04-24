import {
  resetTicketNotificationSenders,
  runTicketNotificationSweep,
  setTicketNotificationSender,
  startTicketNotificationCoordinator,
  stopTicketNotificationCoordinator,
} from "./ticketSlaCoordinator";
import { ticketNotificationStore } from "../tickets/ticketNotificationStore";

describe("ticket notification coordinator", () => {
  beforeEach(async () => {
    await ticketNotificationStore.clear();
    resetTicketNotificationSenders();
    stopTicketNotificationCoordinator();
    jest.restoreAllMocks();
  });

  it("marks pending notifications sent after a successful sweep", async () => {
    await ticketNotificationStore.enqueueForActor({
      ticketId: "ticket-1",
      recipient: { type: "user", id: "owner-1" },
      kind: "assignment",
      payload: { title: "SLA notification" },
    });

    const summary = await runTicketNotificationSweep();
    expect(summary.delivered).toBe(2);

    const notifications = await ticketNotificationStore.list({ recipientType: "user", recipientId: "owner-1" });
    expect(notifications.every((notification) => notification.status === "sent")).toBe(true);
  });

  it("records failures when a sender throws", async () => {
    await ticketNotificationStore.enqueueForActor({
      ticketId: "ticket-2",
      recipient: { type: "agent", id: "backend-agent" },
      kind: "mention",
      payload: { title: "Mentioned in ticket" },
    });

    setTicketNotificationSender("agent_wake", async () => {
      throw new Error("wake pipeline unavailable");
    });

    const summary = await runTicketNotificationSweep();
    expect(summary.failed).toBe(1);

    const notifications = await ticketNotificationStore.list({
      recipientType: "agent",
      recipientId: "backend-agent",
    });
    expect(notifications[0].status).toBe("failed");
    expect(notifications[0].error).toMatch(/wake pipeline unavailable/i);
  });

  it("starts the sweep timer only once", () => {
    const spy = jest.spyOn(global, "setInterval");
    startTicketNotificationCoordinator(100);
    startTicketNotificationCoordinator(100);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
