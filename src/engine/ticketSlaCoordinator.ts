import { ticketNotificationStore, TicketNotification } from "../tickets/ticketNotificationStore";

type NotificationSender = (notification: TicketNotification) => Promise<void>;

const activeDeliveries = new Set<string>();
let ticketNotificationSweepTimer: ReturnType<typeof setInterval> | undefined;

const senders: Record<TicketNotification["channel"], NotificationSender> = {
  inbox: async () => undefined,
  email: async () => undefined,
  agent_wake: async () => undefined,
};

export function setTicketNotificationSender(
  channel: TicketNotification["channel"],
  sender: NotificationSender,
): void {
  senders[channel] = sender;
}

export function resetTicketNotificationSenders(): void {
  senders.inbox = async () => undefined;
  senders.email = async () => undefined;
  senders.agent_wake = async () => undefined;
}

export async function runTicketNotificationSweep(): Promise<{
  scanned: number;
  delivered: number;
  failed: number;
}> {
  const pending = await ticketNotificationStore.list({ status: "pending" });
  let delivered = 0;
  let failed = 0;

  for (const notification of pending) {
    if (activeDeliveries.has(notification.id)) {
      continue;
    }
    activeDeliveries.add(notification.id);
    try {
      await senders[notification.channel](notification);
      await ticketNotificationStore.markSent(notification.id);
      delivered += 1;
    } catch (error) {
      await ticketNotificationStore.markFailed(notification.id, String(error));
      failed += 1;
    } finally {
      activeDeliveries.delete(notification.id);
    }
  }

  return {
    scanned: pending.length,
    delivered,
    failed,
  };
}

export function startTicketNotificationCoordinator(intervalMs = 2_000): void {
  if (ticketNotificationSweepTimer) {
    return;
  }
  ticketNotificationSweepTimer = setInterval(() => {
    void runTicketNotificationSweep();
  }, intervalMs);
  ticketNotificationSweepTimer.unref?.();
}

export function stopTicketNotificationCoordinator(): void {
  if (!ticketNotificationSweepTimer) {
    return;
  }
  clearInterval(ticketNotificationSweepTimer);
  ticketNotificationSweepTimer = undefined;
}
