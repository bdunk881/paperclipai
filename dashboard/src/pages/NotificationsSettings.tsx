import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageSquareWarning, Send, ShieldAlert } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  ConnectionOption,
  fetchNotificationConnectionOptions,
  fetchNotificationPreferences,
  fetchNotificationTransports,
  NotificationCadence,
  NotificationChannel,
  NotificationKind,
  NotificationPreference,
  NotificationTransport,
  sendNotificationTest,
  updateNotificationPreference,
  updateNotificationTransport,
} from "../api/notifications";

const KIND_META: Array<{ kind: NotificationKind; label: string; description: string }> = [
  { kind: "approvals", label: "Approvals", description: "Approval requests and review escalations." },
  { kind: "milestones", label: "Milestones", description: "Shipped milestones and completion updates." },
  { kind: "kpi_alerts", label: "KPI alerts", description: "Performance drops and threshold crossings." },
  { kind: "budget_alerts", label: "Budget alerts", description: "Budget spikes and spend thresholds." },
  { kind: "kill_switch", label: "Kill switch", description: "Critical safety stops and emergency pauses." },
];

const CHANNEL_META: Array<{ channel: NotificationChannel; label: string; helper: string }> = [
  { channel: "slack", label: "Slack", helper: "Route alerts into a team channel using the Slack connector." },
  { channel: "email", label: "Email", helper: "Send digest summaries and transactional alerts via SendGrid." },
  { channel: "sms", label: "SMS", helper: "Reserve SMS for urgent budget and kill switch alerts." },
];

const CADENCE_OPTIONS: Array<{ value: NotificationCadence; label: string }> = [
  { value: "off", label: "Off" },
  { value: "immediate", label: "Immediate" },
  { value: "daily", label: "Daily digest" },
  { value: "weekly", label: "Weekly digest" },
];

function preferenceKey(channel: NotificationChannel, kind: NotificationKind) {
  return `${channel}:${kind}`;
}

function transportMap(transports: NotificationTransport[]): Record<NotificationChannel, NotificationTransport | undefined> {
  return {
    slack: transports.find((item) => item.channel === "slack"),
    email: transports.find((item) => item.channel === "email"),
    sms: transports.find((item) => item.channel === "sms"),
  };
}

export default function NotificationsSettings() {
  const { user, requireAccessToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [transports, setTransports] = useState<NotificationTransport[]>([]);
  const [connectionOptions, setConnectionOptions] = useState<Record<NotificationChannel, ConnectionOption[]>>({
    slack: [],
    email: [],
    sms: [],
  });
  const [transportDrafts, setTransportDrafts] = useState<Record<NotificationChannel, NotificationTransport["config"]>>({
    slack: {},
    email: {},
    sms: {},
  });

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const accessToken = await requireAccessToken();
        const [prefs, transportList, options] = await Promise.all([
          fetchNotificationPreferences(user, accessToken),
          fetchNotificationTransports(user, accessToken),
          fetchNotificationConnectionOptions(user, accessToken),
        ]);
        if (!active) {
          return;
        }
        setPreferences(prefs);
        setTransports(transportList);
        setConnectionOptions(options);
        setTransportDrafts({
          slack: transportList.find((item) => item.channel === "slack")?.config ?? {},
          email: transportList.find((item) => item.channel === "email")?.config ?? {},
          sms: transportList.find((item) => item.channel === "sms")?.config ?? {},
        });
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Failed to load notification settings");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [requireAccessToken, user]);

  const preferencesByKey = useMemo(() => {
    const next = new Map<string, NotificationPreference>();
    for (const item of preferences) {
      next.set(preferenceKey(item.channel, item.kind), item);
    }
    return next;
  }, [preferences]);

  const transportsByChannel = useMemo(() => transportMap(transports), [transports]);

  async function handleCadenceChange(channel: NotificationChannel, kind: NotificationKind, cadence: NotificationCadence) {
    setSavingKey(`${channel}:${kind}`);
    setNotice(null);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      const updated = await updateNotificationPreference(
        {
          channel,
          kind,
          cadence,
          enabled: cadence !== "off",
        },
        user,
        accessToken,
      );
      setPreferences((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update cadence");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleMute(channel: NotificationChannel, kind: NotificationKind) {
    const existing = preferencesByKey.get(preferenceKey(channel, kind));
    if (!existing) {
      return;
    }
    setSavingKey(`mute:${channel}:${kind}`);
    setNotice(null);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      const mutedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const updated = await updateNotificationPreference(
        {
          channel,
          kind,
          cadence: existing.cadence,
          enabled: existing.enabled,
          mutedUntil,
        },
        user,
        accessToken,
      );
      setPreferences((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setNotice(`${channel.toUpperCase()} ${kind.replace(/_/g, " ")} muted for 24 hours.`);
    } catch (muteError) {
      setError(muteError instanceof Error ? muteError.message : "Failed to mute notification");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleTransportSave(channel: NotificationChannel) {
    setSavingKey(`transport:${channel}`);
    setNotice(null);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      const existing = transportsByChannel[channel];
      const updated = await updateNotificationTransport(
        channel,
        {
          connectionId: existing?.connectionId,
          enabled: existing?.enabled ?? true,
          config: Object.fromEntries(
            Object.entries(transportDrafts[channel]).filter(([, value]) => Boolean(value)),
          ) as Record<string, string>,
        },
        user,
        accessToken,
      );
      setTransports((current) => {
        const next = current.filter((item) => item.channel !== channel);
        next.push(updated);
        return next;
      });
      setNotice(`${channel.toUpperCase()} transport saved.`);
    } catch (transportError) {
      setError(transportError instanceof Error ? transportError.message : "Failed to save transport");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleConnectionSelect(channel: NotificationChannel, connectionId: string) {
    setSavingKey(`connection:${channel}`);
    setNotice(null);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      const existing = transportsByChannel[channel];
      const updated = await updateNotificationTransport(
        channel,
        {
          connectionId,
          enabled: existing?.enabled ?? true,
          config: existing?.config ?? {},
        },
        user,
        accessToken,
      );
      setTransports((current) => {
        const next = current.filter((item) => item.channel !== channel);
        next.push(updated);
        return next;
      });
      setTransportDrafts((current) => ({ ...current, [channel]: updated.config }));
      setNotice(`${channel.toUpperCase()} connection updated.`);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : "Failed to update connection");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleTestSend(kind: NotificationKind) {
    setSavingKey(`test:${kind}`);
    setNotice(null);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      await sendNotificationTest(kind, user, accessToken);
      setNotice(`Queued test notification for ${kind.replace(/_/g, " ")}.`);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Failed to queue test notification");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="max-w-6xl p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        <p className="mt-1 text-gray-500">Slack, email, and SMS digests with workspace-level cadence controls.</p>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-5 py-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading notification settings…
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="mb-5 flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-gray-500" />
              <div>
                <h2 className="text-base font-semibold text-gray-900">Channel transports</h2>
                <p className="text-sm text-gray-500">Attach one connected provider per channel and set delivery targets.</p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              {CHANNEL_META.map((meta) => {
                const transport = transportsByChannel[meta.channel];
                const options = connectionOptions[meta.channel];
                return (
                  <div key={meta.channel} className="rounded-xl border border-gray-200 p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-gray-900">{meta.label}</h3>
                      <p className="mt-1 text-xs text-gray-500">{meta.helper}</p>
                    </div>

                    <label className="mb-3 block text-xs font-medium uppercase tracking-wide text-gray-500">
                      Connected provider
                      <select
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        value={transport?.connectionId ?? ""}
                        onChange={(event) => void handleConnectionSelect(meta.channel, event.target.value)}
                      >
                        <option value="">Select a connected provider</option>
                        {options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {meta.channel === "slack" ? (
                      <>
                        <input
                          className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          placeholder="Slack channel ID"
                          value={transportDrafts.slack.slackChannelId ?? ""}
                          onChange={(event) =>
                            setTransportDrafts((current) => ({
                              ...current,
                              slack: { ...current.slack, slackChannelId: event.target.value },
                            }))
                          }
                        />
                        <input
                          className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          placeholder="Channel label"
                          value={transportDrafts.slack.slackChannelName ?? ""}
                          onChange={(event) =>
                            setTransportDrafts((current) => ({
                              ...current,
                              slack: { ...current.slack, slackChannelName: event.target.value },
                            }))
                          }
                        />
                      </>
                    ) : null}

                    {meta.channel === "email" ? (
                      <>
                        <input
                          className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          placeholder="Recipient email"
                          value={transportDrafts.email.recipientEmail ?? ""}
                          onChange={(event) =>
                            setTransportDrafts((current) => ({
                              ...current,
                              email: { ...current.email, recipientEmail: event.target.value },
                            }))
                          }
                        />
                        <input
                          className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          placeholder="From email"
                          value={transportDrafts.email.fromEmail ?? ""}
                          onChange={(event) =>
                            setTransportDrafts((current) => ({
                              ...current,
                              email: { ...current.email, fromEmail: event.target.value },
                            }))
                          }
                        />
                        <input
                          className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          placeholder="From name"
                          value={transportDrafts.email.fromName ?? ""}
                          onChange={(event) =>
                            setTransportDrafts((current) => ({
                              ...current,
                              email: { ...current.email, fromName: event.target.value },
                            }))
                          }
                        />
                      </>
                    ) : null}

                    {meta.channel === "sms" ? (
                      <>
                        <input
                          className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          placeholder="To phone"
                          value={transportDrafts.sms.toPhone ?? ""}
                          onChange={(event) =>
                            setTransportDrafts((current) => ({
                              ...current,
                              sms: { ...current.sms, toPhone: event.target.value },
                            }))
                          }
                        />
                        <input
                          className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          placeholder="From phone"
                          value={transportDrafts.sms.fromPhone ?? ""}
                          onChange={(event) =>
                            setTransportDrafts((current) => ({
                              ...current,
                              sms: { ...current.sms, fromPhone: event.target.value },
                            }))
                          }
                        />
                      </>
                    ) : null}

                    <button
                      className="inline-flex items-center rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white"
                      onClick={() => void handleTransportSave(meta.channel)}
                      disabled={savingKey === `transport:${meta.channel}`}
                    >
                      {savingKey === `transport:${meta.channel}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save {meta.label}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="mb-5 flex items-center gap-3">
              <MessageSquareWarning className="h-5 w-5 text-gray-500" />
              <div>
                <h2 className="text-base font-semibold text-gray-900">Cadence by notification type</h2>
                <p className="text-sm text-gray-500">Set independent digests per channel and mute noisy streams temporarily.</p>
              </div>
            </div>

            <div className="space-y-4">
              {KIND_META.map((meta) => (
                <div key={meta.kind} className="rounded-xl border border-gray-200">
                  <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-4 py-4">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{meta.label}</h3>
                      <p className="mt-1 text-xs text-gray-500">{meta.description}</p>
                    </div>
                    <button
                      className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
                      onClick={() => void handleTestSend(meta.kind)}
                      disabled={savingKey === `test:${meta.kind}`}
                    >
                      {savingKey === `test:${meta.kind}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      Send test
                    </button>
                  </div>

                  <div className="grid gap-3 p-4 lg:grid-cols-3">
                    {CHANNEL_META.map((channel) => {
                      const preference = preferencesByKey.get(preferenceKey(channel.channel, meta.kind));
                      return (
                        <div key={channel.channel} className="rounded-lg border border-gray-200 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-900">{channel.label}</span>
                            {preference?.mutedUntil ? (
                              <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-700">
                                Muted
                              </span>
                            ) : null}
                          </div>
                          <select
                            className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                            value={preference?.cadence ?? "off"}
                            onChange={(event) =>
                              void handleCadenceChange(channel.channel, meta.kind, event.target.value as NotificationCadence)
                            }
                          >
                            {CADENCE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <button
                            className="text-xs font-medium text-gray-600 underline"
                            onClick={() => void handleMute(channel.channel, meta.kind)}
                            disabled={savingKey === `mute:${channel.channel}:${meta.kind}`}
                          >
                            Mute 24h
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
