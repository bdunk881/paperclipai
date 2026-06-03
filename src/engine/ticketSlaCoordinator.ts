import { ticketNotificationStore, TicketNotification } from "../tickets/ticketNotificationStore";
import { CoordinatorLockKey, runWithAdvisoryLock } from "./coordinatorLock";

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
  // B1/HEL-458: single-instance processing per tick so the 2-machine fleet
  // can't double-deliver SLA escalations.
  let result = { scanned: 0, delivered: 0, failed: 0 };
  await runWithAdvisoryLock(CoordinatorLockKey.ticketNotification, async () => {
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

    result = {
      scanned: pending.length,
      delivered,
      failed,
    };
  });
  return result;
}

export function startTicketNotificationCoordinator(intervalMs = 2_000): void {
  if (ticketNotificationSweepTimer) {
    return;
  }
  ticketNotificationSweepTimer = setInterval(() => {
    void runTicketNotificationSweep().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[tickets] Notification sweep skipped:", message);
    });
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
