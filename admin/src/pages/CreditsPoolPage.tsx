/**
 * HEL-250 — credits pool admin (`platform_provider_keys`).
 *
 * Table of every key source the platform uses to front credit-mode customer
 * calls. The list endpoint returns metadata only — the key ciphertext never
 * touches this page. Create + rotate return the masked tail; the plaintext
 * shown after create is what the operator typed (we don't fetch it back).
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "../lib/apiClient";
import { ReasonPrompt } from "../components/ReasonPrompt";

type Status = "active" | "throttled" | "low_balance" | "disabled" | "retired";

interface KeySourceRow {
  id: string;
  sourceKind: "openrouter" | "direct";
  provider: string;
  label: string;
  status: Status;
  throttledUntil: string | null;
  prepaidBalanceUsd: number | null;
  prepaidBalanceObservedAt: string | null;
  dailySpendCapUsd: number | null;
  currentDaySpendUsd: number;
  lastFourteenTwentyNineAt: string | null;
  consecutive429Count: number;
  priority: number;
}

const ALL_STATUSES: ReadonlyArray<Status | "all"> = [
  "all",
  "active",
  "throttled",
  "low_balance",
  "disabled",
];

function statusPillClass(s: Status): string {
  switch (s) {
    case "active":
      return "pill success";
    case "throttled":
    case "low_balance":
      return "pill warning";
    case "disabled":
    case "retired":
      return "pill danger";
  }
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtPctOfCap(spend: number, cap: number | null): string {
  if (cap == null || cap <= 0) return "no cap";
  return `${((spend / cap) * 100).toFixed(1)}%`;
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function CreditsPoolPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [showAdd, setShowAdd] = useState(false);

  const list = useQuery({
    queryKey: ["credits-pool"],
    queryFn: () => apiRequest<{ rows: KeySourceRow[] }>("/api/admin-console/credits/key-sources"),
    refetchInterval: 30_000,
  });

  const filtered = useMemo(() => {
    const rows = list.data?.rows ?? [];
    if (statusFilter === "all") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [list.data, statusFilter]);

  const reload = () => qc.invalidateQueries({ queryKey: ["credits-pool"] });

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2>Credits pool</h2>
            <p className="muted" style={{ margin: 0 }}>
              Platform-owned provider keys that fund credit-mode customer calls. The watchdog refreshes
              balances every 15 minutes; this page polls every 30 seconds.
            </p>
          </div>
          <button className="primary" onClick={() => setShowAdd(true)}>
            Add key
          </button>
        </div>

        <div className="tabs" style={{ marginTop: "1rem" }}>
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={statusFilter === s ? "active" : ""}
            >
              {s}
            </button>
          ))}
        </div>

        {list.isLoading && <div className="muted">Loading…</div>}
        {list.isError && (
          <div className="banner danger">
            {(list.error as ApiError | Error).message}
          </div>
        )}
        {list.data && filtered.length === 0 && (
          <div className="muted">No key sources matching this filter.</div>
        )}
        {filtered.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Label</th>
                <th>Status</th>
                <th>Prepaid balance</th>
                <th>Today&apos;s spend / cap</th>
                <th>Priority</th>
                <th>429s</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.provider}</strong>
                    <div className="muted" style={{ fontSize: ".75rem" }}>
                      {r.sourceKind}
                    </div>
                  </td>
                  <td>{r.label}</td>
                  <td>
                    <span className={statusPillClass(r.status)}>{r.status}</span>
                    {r.status === "throttled" && r.throttledUntil && (
                      <div className="muted" style={{ fontSize: ".75rem" }}>
                        until {new Date(r.throttledUntil).toLocaleTimeString()}
                      </div>
                    )}
                  </td>
                  <td>
                    {fmtUsd(r.prepaidBalanceUsd)}
                    <div className="muted" style={{ fontSize: ".75rem" }}>
                      as of {relTime(r.prepaidBalanceObservedAt)}
                    </div>
                  </td>
                  <td>
                    {fmtUsd(r.currentDaySpendUsd)} / {fmtUsd(r.dailySpendCapUsd)}
                    <div className="muted" style={{ fontSize: ".75rem" }}>
                      {fmtPctOfCap(r.currentDaySpendUsd, r.dailySpendCapUsd)}
                    </div>
                  </td>
                  <td>{r.priority}</td>
                  <td>
                    {r.consecutive429Count > 0 ? (
                      <>
                        <strong>{r.consecutive429Count}</strong>
                        <div className="muted" style={{ fontSize: ".75rem" }}>
                          last {relTime(r.lastFourteenTwentyNineAt)}
                        </div>
                      </>
                    ) : (
                      "0"
                    )}
                  </td>
                  <td>
                    <RowActions row={r} onChange={reload} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddKeyModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function RowActions({ row, onChange }: { row: KeySourceRow; onChange: () => void }) {
  const [rotating, setRotating] = useState(false);
  const [editingPriority, setEditingPriority] = useState(false);
  const [editingCap, setEditingCap] = useState(false);
  const [priorityValue, setPriorityValue] = useState(String(row.priority));
  const [capValue, setCapValue] = useState(row.dailySpendCapUsd != null ? String(row.dailySpendCapUsd) : "");

  return (
    <div className="row">
      <button onClick={() => setRotating((v) => !v)}>Rotate</button>
      <button onClick={() => setEditingPriority((v) => !v)}>Priority</button>
      <button onClick={() => setEditingCap((v) => !v)}>Cap</button>
      <ReasonPrompt
        label="Disable"
        className="danger"
        onConfirm={async (reason) => {
          await apiRequest(`/api/admin-console/credits/key-sources/${row.id}/disable`, {
            method: "POST",
            body: { reason },
          });
          onChange();
        }}
      />
      {rotating && (
        <RotateForm
          rowId={row.id}
          onDone={() => {
            setRotating(false);
            onChange();
          }}
        />
      )}
      {editingPriority && (
        <PatchField
          label="priority"
          value={priorityValue}
          setValue={setPriorityValue}
          onSubmit={async (reason) => {
            await apiRequest(`/api/admin-console/credits/key-sources/${row.id}`, {
              method: "PATCH",
              body: { priority: Number(priorityValue), reason },
            });
            setEditingPriority(false);
            onChange();
          }}
        />
      )}
      {editingCap && (
        <PatchField
          label="daily cap (USD; blank=none)"
          value={capValue}
          setValue={setCapValue}
          onSubmit={async (reason) => {
            const body: Record<string, unknown> = { reason };
            body.daily_spend_cap_usd = capValue.trim() === "" ? null : Number(capValue);
            await apiRequest(`/api/admin-console/credits/key-sources/${row.id}`, {
              method: "PATCH",
              body,
            });
            setEditingCap(false);
            onChange();
          }}
        />
      )}
    </div>
  );
}

function RotateForm({ rowId, onDone }: { rowId: string; onDone: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ masked_key: string } | null>(null);
  const mutation = useMutation({
    mutationFn: async () =>
      apiRequest<{ masked_key: string }>(`/api/admin-console/credits/key-sources/${rowId}/rotate`, {
        method: "POST",
        body: { api_key: apiKey, reason },
      }),
    onSuccess: (data) => {
      setResult(data);
      setApiKey("");
    },
  });

  if (result) {
    return (
      <div className="banner" style={{ width: "100%" }}>
        Rotated. New key ends in <span className="code">{result.masked_key}</span>.{" "}
        <button onClick={onDone}>Close</button>
      </div>
    );
  }

  return (
    <div className="row" style={{ width: "100%", marginTop: "0.25rem" }}>
      <input
        type="password"
        placeholder="new api key"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        style={{ flex: 2 }}
      />
      <input
        type="text"
        placeholder="reason (audited)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ flex: 2 }}
      />
      <button
        className="primary"
        disabled={mutation.isPending || apiKey.length < 8 || !reason.trim()}
        onClick={() => mutation.mutate()}
      >
        Rotate
      </button>
      {mutation.isError && (
        <div className="banner danger">{(mutation.error as Error).message}</div>
      )}
    </div>
  );
}

function PatchField({
  label,
  value,
  setValue,
  onSubmit,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="row" style={{ width: "100%", marginTop: "0.25rem" }}>
      <input
        placeholder={label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ flex: 1 }}
      />
      <input
        placeholder="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ flex: 1 }}
      />
      <button
        className="primary"
        disabled={busy || !reason.trim()}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onSubmit(reason);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save
      </button>
      {error && <div className="banner danger">{error}</div>}
    </div>
  );
}

function AddKeyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [sourceKind, setSourceKind] = useState<"openrouter" | "direct">("openrouter");
  const [provider, setProvider] = useState("openrouter");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState("");
  const [cap, setCap] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ masked_key: string; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        source_kind: sourceKind,
        provider: provider.trim(),
        label: label.trim(),
        api_key: apiKey,
        reason: reason.trim(),
      };
      if (priority.trim()) body.priority = Number(priority);
      if (cap.trim()) body.daily_spend_cap_usd = Number(cap);
      const r = await apiRequest<{ id: string; masked_key: string }>(
        "/api/admin-console/credits/key-sources",
        { method: "POST", body },
      );
      setResult(r);
      setApiKey("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <ModalShell onClose={onClose} title="Key added">
        <div className="banner">
          Created <span className="code">{result.id}</span>. Stored key ends in{" "}
          <span className="code">{result.masked_key}</span>. The plaintext is not retrievable.
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="primary" onClick={onCreated}>
            Done
          </button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose} title="Add key source">
      <div className="field">
        <label>Source kind</label>
        <select
          value={sourceKind}
          onChange={(e) => {
            const k = e.target.value as "openrouter" | "direct";
            setSourceKind(k);
            if (k === "openrouter") setProvider("openrouter");
          }}
        >
          <option value="openrouter">openrouter</option>
          <option value="direct">direct</option>
        </select>
      </div>
      <div className="field">
        <label>Provider</label>
        <input
          value={provider}
          disabled={sourceKind === "openrouter"}
          onChange={(e) => setProvider(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. or-main, ant-east" />
      </div>
      <div className="field">
        <label>API key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label>Priority (lower wins; defaults to 100 for openrouter, 10 for direct)</label>
        <input
          value={priority}
          inputMode="numeric"
          onChange={(e) => setPriority(e.target.value.replace(/[^0-9]/g, ""))}
        />
      </div>
      <div className="field">
        <label>Daily spend cap (USD, optional)</label>
        <input
          value={cap}
          inputMode="decimal"
          onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))}
        />
      </div>
      <div className="field">
        <label>Reason (audited)</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {error && <div className="banner danger">{error}</div>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy || apiKey.length < 8 || !label.trim() || !reason.trim() || !provider.trim()}
          onClick={submit}
        >
          Create
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(11, 18, 32, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#ffffff",
          borderRadius: 8,
          maxWidth: 480,
          width: "92vw",
          padding: "1.25rem",
        }}
      >
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
