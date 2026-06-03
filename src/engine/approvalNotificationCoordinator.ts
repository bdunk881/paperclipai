import { approvalNotificationStore, ApprovalNotification } from "./approvalNotificationStore";
import { buildApprovalNotificationSenders } from "./approvalNotificationSenders";
import { CoordinatorLockKey, runWithAdvisoryLock } from "./coordinatorLock";

type NotificationSender = (notification: ApprovalNotification) => Promise<void>;

const activeDeliveries = new Set<string>();
let deliverySweepTimer: ReturnType<typeof setInterval> | undefined;

const senders: Record<ApprovalNotification["channel"], NotificationSender> =
  buildApprovalNotificationSenders();

export function setApprovalNotificationSender(
  channel: ApprovalNotification["channel"],
  sender: NotificationSender
): void {
  senders[channel] = sender;
}

export function resetApprovalNotificationSenders(): void {
  const defaults = buildApprovalNotificationSenders();
  senders.inbox = defaults.inbox;
  senders.email = defaults.email;
}

export async function runApprovalNotificationSweep(): Promise<{
  scanned: number;
  delivered: number;
  failed: number;
}> {
  // B1/HEL-458: only one instance processes the pending batch per tick, so the
  // 2-machine fleet can't double-send approval notifications.
  let result = { scanned: 0, delivered: 0, failed: 0 };
  await runWithAdvisoryLock(CoordinatorLockKey.approvalNotification, async () => {
    // DASH-43: list() is async + Postgres-aware. Pre-fix, this loop only saw
    // memoryStore entries and ignored every persisted pending notification.
    const pendingNotifications = await approvalNotificationStore.list({ status: "pending" });
    let delivered = 0;
    let failed = 0;

    for (const notification of pendingNotifications) {
      if (activeDeliveries.has(notification.id)) {
        continue;
      }

      activeDeliveries.add(notification.id);
      try {
        await senders[notification.channel](notification);
        await approvalNotificationStore.markSent(notification.id);
        delivered += 1;
      } catch (error) {
        await approvalNotificationStore.markFailed(notification.id, String(error));
        failed += 1;
      } finally {
        activeDeliveries.delete(notification.id);
      }
    }

    result = {
      scanned: pendingNotifications.length,
      delivered,
      failed,
    };
  });
  return result;
}

export function startApprovalNotificationCoordinator(intervalMs = 2_000): void {
  if (deliverySweepTimer) {
    return;
  }

  deliverySweepTimer = setInterval(() => {
    void runApprovalNotificationSweep();
  }, intervalMs);

  deliverySweepTimer.unref?.();
}

export function stopApprovalNotificationCoordinator(): void {
  if (!deliverySweepTimer) {
    return;
  }

  clearInterval(deliverySweepTimer);
  deliverySweepTimer = undefined;
}
