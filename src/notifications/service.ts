import { randomUUID } from "crypto";
import { deliverNotification } from "./delivery";
import { notificationStore } from "./store";
import {
  NotificationCadence,
  NotificationChannel,
  NotificationHealth,
  NotificationKind,
  NotificationPreference,
  NotificationTransportConfig,
} from "./types";

const DIGEST_INTERVAL_MS: Record<Exclude<NotificationCadence, "off" | "immediate">, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

function nowIso(): string {
  return new Date().toISOString();
}

function cadenceEnabled(cadence: NotificationCadence): cadence is Exclude<NotificationCadence, "off"> {
  return cadence !== "off";
}

function isMuted(preference: NotificationPreference): boolean {
  return Boolean(preference.mutedUntil && Date.parse(preference.mutedUntil) > Date.now());
}

function digestDue(preference: NotificationPreference): preference is NotificationPreference & {
  cadence: "daily" | "weekly";
} {
  if (preference.cadence !== "daily" && preference.cadence !== "weekly") {
    return false;
  }

  if (!preference.lastDigestSentAt) {
    return true;
  }

  return Date.now() - Date.parse(preference.lastDigestSentAt) >= DIGEST_INTERVAL_MS[preference.cadence];
}

export class NotificationService {
  async listPreferences(workspaceId: string): Promise<NotificationPreference[]> {
    return notificationStore.listPreferences(workspaceId);
  }

  async updatePreference(input: {
    workspaceId: string;
    channel: NotificationChannel;
    kind: NotificationKind;
    cadence: NotificationCadence;
    enabled?: boolean;
    mutedUntil?: string | null;
  }): Promise<NotificationPreference> {
    const existing = (await notificationStore.listPreferences(input.workspaceId)).find(
      (item) => item.channel === input.channel && item.kind === input.kind,
    );
    const now = nowIso();
    const next: NotificationPreference = {
      id: existing?.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      channel: input.channel,
      kind: input.kind,
      cadence: input.cadence,
      enabled: input.enabled ?? input.cadence !== "off",
      mutedUntil: input.mutedUntil ?? undefined,
      lastDigestSentAt: existing?.lastDigestSentAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return notificationStore.upsertPreference(next);
  }

  async listTransportConfigs(workspaceId: string): Promise<NotificationTransportConfig[]> {
    return notificationStore.listTransportConfigs(workspaceId);
  }

  async upsertTransportConfig(input: {
    workspaceId: string;
    channel: NotificationChannel;
    ownerUserId: string;
    connectionId?: string;
    enabled: boolean;
    config: NotificationTransportConfig["config"];
  }): Promise<NotificationTransportConfig> {
    const existing = (await notificationStore.listTransportConfigs(input.workspaceId)).find(
      (item) => item.channel === input.channel,
    );
    const now = nowIso();
    return notificationStore.upsertTransportConfig({
      id: existing?.id ?? randomUUID(),
      workspaceId: input.workspaceId,
      channel: input.channel,
      ownerUserId: input.ownerUserId,
      connectionId: input.connectionId,
      enabled: input.enabled,
      config: { ...input.config },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async recordEvent(input: {
    workspaceId: string;
    kind: NotificationKind;
    title: string;
    summary: string;
    severity?: "info" | "warning" | "critical";
    source?: string;
    metadata?: Record<string, unknown>;
    occurredAt?: string;
  }) {
    return notificationStore.appendEvent(input);
  }

  async health(workspaceId: string): Promise<NotificationHealth> {
    const transports = await notificationStore.listTransportConfigs(workspaceId);
    const checkedAt = nowIso();
    return {
      workspaceId,
      checkedAt,
      channels: (["slack", "email", "sms"] as NotificationChannel[]).map((channel) => {
        const match = transports.find((item) => item.channel === channel);
        if (!match) {
          return {
            channel,
            configured: false,
            enabled: false,
            detail: "No transport configured",
          };
        }
        return {
          channel,
          configured: Boolean(match.connectionId),
          enabled: match.enabled,
          detail: match.connectionId ? "Ready" : "Connection missing",
        };
      }),
    };
  }

  async sendTestEvent(input: {
    workspaceId: string;
    kind: NotificationKind;
    title?: string;
    summary?: string;
    severity?: "info" | "warning" | "critical";
  }) {
    const event = await this.recordEvent({
      workspaceId: input.workspaceId,
      kind: input.kind,
      title: input.title ?? "Test notification",
      summary: input.summary ?? `Test delivery for ${input.kind}`,
      severity: input.severity ?? "info",
      source: "manual-test",
    });
    await this.runSweepForWorkspace(input.workspaceId);
    return event;
  }

  async runSweepForWorkspace(workspaceId: string): Promise<{ delivered: number; failed: number }> {
    const preferences = await notificationStore.listPreferences(workspaceId);
    const transports = await notificationStore.listTransportConfigs(workspaceId);
    let delivered = 0;
    let failed = 0;

    for (const preference of preferences) {
      if (!preference.enabled || isMuted(preference) || !cadenceEnabled(preference.cadence)) {
        continue;
      }

      const transport = transports.find((item) => item.channel === preference.channel && item.enabled);
      if (!transport || !transport.connectionId) {
        continue;
      }

      if (preference.cadence === "immediate") {
        const pending = await notificationStore.listUndeliveredEvents({
          workspaceId,
          kind: preference.kind,
          channel: preference.channel,
          cadence: "immediate",
        });

        for (const event of pending) {
          try {
            await deliverNotification({
              transport,
              events: [event],
              cadence: "immediate",
              workspaceId,
              kind: preference.kind,
            });
            await notificationStore.saveDelivery({
              workspaceId,
              eventId: event.id,
              channel: preference.channel,
              cadence: "immediate",
              deliveredAt: nowIso(),
              status: "sent",
            });
            delivered += 1;
          } catch (error) {
            await notificationStore.saveDelivery({
              workspaceId,
              eventId: event.id,
              channel: preference.channel,
              cadence: "immediate",
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            });
            failed += 1;
          }
        }
        continue;
      }

      if (!digestDue(preference)) {
        continue;
      }

      const pending = await notificationStore.listUndeliveredEvents({
        workspaceId,
        kind: preference.kind,
        channel: preference.channel,
        cadence: preference.cadence,
        after: preference.lastDigestSentAt,
      });
      if (pending.length === 0) {
        continue;
      }

      try {
        await deliverNotification({
          transport,
          events: pending,
          cadence: preference.cadence,
          workspaceId,
          kind: preference.kind,
        });

        for (const event of pending) {
          await notificationStore.saveDelivery({
            workspaceId,
            eventId: event.id,
            channel: preference.channel,
            cadence: preference.cadence,
            deliveredAt: nowIso(),
            status: "sent",
          });
        }
        await notificationStore.upsertPreference({
          ...preference,
          lastDigestSentAt: nowIso(),
        });
        delivered += pending.length;
      } catch (error) {
        for (const event of pending) {
          await notificationStore.saveDelivery({
            workspaceId,
            eventId: event.id,
            channel: preference.channel,
            cadence: preference.cadence,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
        failed += pending.length;
      }
    }

    return { delivered, failed };
  }
}

export const notificationService = new NotificationService();
