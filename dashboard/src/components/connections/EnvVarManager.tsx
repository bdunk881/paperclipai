/**
 * HEL-206 (PR C): EnvVarManager - the high-trust env var dashboard surface.
 *
 * Lists workspace env vars (name, scope chips, last-used) with Rotate / Delete
 * actions. The add modal collects a name, a write-only password input for the
 * value, and a multi-select scope picker (mission / team / agent) that reuses
 * `ScopePermissionSlider` from PR B (HEL-205). The slider is locally stubbed
 * in PR C; see the TODO at the top of that file.
 *
 * Plaintext is sent to the server only on create/rotate - list responses
 * never include the ciphertext or any portion of the plaintext. The deref
 * path is server-side (POST /api/env-vars/:id/deref-token).
 */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, EyeOff, KeyRound, Plus, RefreshCw, Trash2, X } from "lucide-react";
import {
  createEnvVar,
  deleteEnvVar,
  listEnvVars,
  rotateEnvVar,
  type EnvVarGrant,
  type EnvVarPermission,
  type EnvVarRecord,
  type EnvVarScopeKind,
} from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import ScopePermissionSlider from "./ScopePermissionSlider";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function emptyGrant(scopeKind: EnvVarScopeKind = "agent"): EnvVarGrant {
  return { scope_kind: scopeKind, scope_id: "", permission: "allow" };
}

export default function EnvVarManager() {
  const { requireAccessToken } = useAuth();
  const [envVars, setEnvVars] = useState<EnvVarRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Add modal state
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [grants, setGrants] = useState<EnvVarGrant[]>([]);

  // Rotation prompt
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateValue, setRotateValue] = useState("");

  const totalActiveGrants = useMemo(
    () => envVars.reduce((sum, v) => sum + v.grants.length, 0),
    [envVars],
  );

  const loadVars = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const accessToken = await requireAccessToken();
      setEnvVars(await listEnvVars(accessToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load env vars");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void loadVars();
  }, [loadVars]);

  function resetAddModal() {
    setShowAddModal(false);
    setName("");
    setValue("");
    setShowValue(false);
    setGrants([]);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    if (!value) {
      setError("Value is required.");
      return;
    }
    // Drop empty-scope-id grants the user added but never filled in.
    const cleanGrants = grants.filter((g) => g.scope_id.trim().length > 0);
    setSubmitting(true);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      await createEnvVar({ name: trimmedName, value, grants: cleanGrants }, accessToken);
      resetAddModal();
      await loadVars();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create env var");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRotate(id: string) {
    if (!rotateValue) {
      setError("New value required for rotation.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      await rotateEnvVar(id, rotateValue, accessToken);
      setRotatingId(null);
      setRotateValue("");
      await loadVars();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate env var");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(envVar: EnvVarRecord) {
    if (!confirm(`Delete env var '${envVar.name}'? This cannot be undone.`)) return;
    setSubmitting(true);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      await deleteEnvVar(envVar.id, accessToken);
      await loadVars();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete env var");
    } finally {
      setSubmitting(false);
    }
  }

  function addGrantRow() {
    setGrants((prev) => [...prev, emptyGrant()]);
  }

  function updateGrant(idx: number, patch: Partial<EnvVarGrant>) {
    setGrants((prev) => prev.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  }

  function removeGrant(idx: number) {
    setGrants((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="af2-page" style={{ maxWidth: 1080 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Connections / Environment</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Environment Variables
          </h1>
          <div className="af2-page-head-meta">
            Encrypted at rest. Values are never returned by the list endpoint; the deref token path
            handles run-time access on a per-scope grant basis.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadVars()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-af2-line px-3 py-2 text-xs font-medium text-af2-ink-3 hover:bg-af2-paper-2"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-af2-ink px-3 py-2 text-sm font-medium text-white hover:bg-af2-ink-2"
          >
            <Plus size={14} />
            Add variable
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-af2-clay/30 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="rounded-xl border border-af2-line bg-af2-card">
        <div className="flex items-center justify-between border-b border-af2-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-af2-ink">Workspace env vars</h2>
            <p className="mt-1 text-xs text-af2-ink-3">
              {envVars.length} variable{envVars.length === 1 ? "" : "s"} / {totalActiveGrants} scope grant
              {totalActiveGrants === 1 ? "" : "s"}
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-af2-line bg-af2-paper-2 px-3 py-1.5 text-xs text-af2-ink-3">
            <KeyRound size={14} />
            AES-256-GCM at rest
          </div>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-sm text-af2-ink-3">Loading variables...</div>
        ) : envVars.length === 0 ? (
          <div className="px-5 py-10 text-sm text-af2-ink-3">
            No environment variables yet. Add one to expose it (with scope grants) to your agents.
          </div>
        ) : (
          <div className="divide-y divide-af2-line">
            {envVars.map((envVar) => (
              <div
                key={envVar.id}
                className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-semibold text-af2-ink">
                    {envVar.name}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {envVar.grants.length === 0 ? (
                      <span className="rounded-full border border-af2-line bg-af2-paper-2 px-2 py-0.5 text-[11px] font-medium text-af2-ink-4">
                        no grants
                      </span>
                    ) : (
                      envVar.grants.map((g) => (
                        <span
                          key={`${g.scope_kind}:${g.scope_id}`}
                          className="rounded-full border border-af2-line bg-af2-paper-2 px-2 py-0.5 text-[11px] font-medium text-af2-ink-3"
                          title={`${g.scope_kind}:${g.scope_id} - ${g.permission}`}
                        >
                          {g.scope_kind}:{g.scope_id.slice(0, 8)} - {g.permission}
                        </span>
                      ))
                    )}
                  </div>
                  <p className="mt-2 text-xs text-af2-ink-4">
                    Created {formatDate(envVar.createdAt)} / Last used {formatDate(envVar.lastUsedAt)} / key v{envVar.keyVersion}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRotatingId(envVar.id);
                      setRotateValue("");
                    }}
                    disabled={submitting}
                    aria-label={`Rotate ${envVar.name}`}
                    className="inline-flex items-center gap-2 rounded-lg border border-af2-line px-3 py-2 text-xs font-medium text-af2-ink-3 hover:bg-af2-paper-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw size={14} />
                    Rotate
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(envVar)}
                    disabled={submitting}
                    aria-label={`Delete ${envVar.name}`}
                    className="inline-flex items-center gap-2 rounded-lg border border-af2-line px-3 py-2 text-xs font-medium text-af2-clay hover:bg-af2-clay-soft/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- Add modal ---------------- */}
      {showAddModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="env-var-add-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-af2-ink/40 px-4 py-8"
        >
          <form
            onSubmit={handleCreate}
            className="w-full max-w-lg overflow-hidden rounded-xl border border-af2-line bg-af2-card shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-af2-line px-5 py-4">
              <h2 id="env-var-add-title" className="text-sm font-semibold text-af2-ink">
                Add environment variable
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={resetAddModal}
                className="rounded-full p-1 text-af2-ink-3 hover:bg-af2-paper-2"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <label className="block text-xs font-medium text-af2-ink-3" htmlFor="env-var-name">
                Name
                <input
                  id="env-var-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={200}
                  placeholder="STRIPE_SECRET_KEY"
                  className="mt-1 w-full rounded-lg border border-af2-line bg-af2-card px-3 py-2 font-mono text-sm text-af2-ink outline-none focus:border-af2-clay"
                />
              </label>
              <label className="block text-xs font-medium text-af2-ink-3" htmlFor="env-var-value">
                Value (write-only)
                <div className="mt-1 flex items-stretch gap-2">
                  <input
                    id="env-var-value"
                    type={showValue ? "text" : "password"}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    required
                    placeholder="sk_live_..."
                    className="flex-1 rounded-lg border border-af2-line bg-af2-card px-3 py-2 font-mono text-sm text-af2-ink outline-none focus:border-af2-clay"
                  />
                  <button
                    type="button"
                    onClick={() => setShowValue((s) => !s)}
                    aria-label={showValue ? "Hide value" : "Show value"}
                    className="inline-flex items-center justify-center rounded-lg border border-af2-line px-3 text-af2-ink-3 hover:bg-af2-paper-2"
                  >
                    {showValue ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-af2-ink-4">
                  Stored encrypted. Value is never displayed after save.
                </p>
              </label>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-af2-ink-3">Scope grants</span>
                  <button
                    type="button"
                    onClick={addGrantRow}
                    className="inline-flex items-center gap-1 text-xs font-medium text-af2-clay hover:underline"
                  >
                    <Plus size={12} />
                    Add scope
                  </button>
                </div>
                {grants.length === 0 ? (
                  <p className="mt-2 rounded-md border border-dashed border-af2-line bg-af2-paper-2 px-3 py-2 text-xs text-af2-ink-4">
                    No scope grants yet. Add at least one mission / team / agent grant to make the variable
                    available to runs.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {grants.map((grant, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-[120px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border border-af2-line bg-af2-paper px-2 py-2"
                      >
                        <select
                          aria-label={`Scope kind ${idx + 1}`}
                          value={grant.scope_kind}
                          onChange={(e) =>
                            updateGrant(idx, { scope_kind: e.target.value as EnvVarScopeKind })
                          }
                          className="rounded-md border border-af2-line bg-af2-card px-2 py-1 text-xs text-af2-ink"
                        >
                          <option value="mission">mission</option>
                          <option value="team">team</option>
                          <option value="agent">agent</option>
                        </select>
                        <input
                          aria-label={`Scope id ${idx + 1}`}
                          value={grant.scope_id}
                          onChange={(e) => updateGrant(idx, { scope_id: e.target.value })}
                          placeholder="scope id (mission/team/agent)"
                          className="rounded-md border border-af2-line bg-af2-card px-2 py-1 font-mono text-xs text-af2-ink"
                        />
                        <ScopePermissionSlider
                          value={grant.permission}
                          onChange={(p) => updateGrant(idx, { permission: p as EnvVarPermission })}
                        />
                        <button
                          type="button"
                          onClick={() => removeGrant(idx)}
                          aria-label={`Remove scope ${idx + 1}`}
                          className="rounded-md p-1 text-af2-ink-3 hover:bg-af2-paper-2"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-af2-line px-5 py-4">
              <button
                type="button"
                onClick={resetAddModal}
                className="rounded-lg border border-af2-line px-3 py-2 text-xs font-medium text-af2-ink-3 hover:bg-af2-paper-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-af2-ink px-3 py-2 text-sm font-medium text-white hover:bg-af2-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save variable
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------------- Rotate prompt ---------------- */}
      {rotatingId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="env-var-rotate-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-af2-ink/40 px-4 py-8"
        >
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-af2-line bg-af2-card shadow-xl">
            <div className="flex items-center justify-between border-b border-af2-line px-5 py-4">
              <h2 id="env-var-rotate-title" className="text-sm font-semibold text-af2-ink">
                Rotate variable
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  setRotatingId(null);
                  setRotateValue("");
                }}
                className="rounded-full p-1 text-af2-ink-3 hover:bg-af2-paper-2"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block text-xs font-medium text-af2-ink-3" htmlFor="env-var-rotate-value">
                New value
                <input
                  id="env-var-rotate-value"
                  type="password"
                  value={rotateValue}
                  onChange={(e) => setRotateValue(e.target.value)}
                  required
                  placeholder="New plaintext value"
                  className="mt-1 w-full rounded-lg border border-af2-line bg-af2-card px-3 py-2 font-mono text-sm text-af2-ink outline-none focus:border-af2-clay"
                />
              </label>
              <p className="text-[11px] text-af2-ink-4">
                The previous value is overwritten. Existing scope grants are preserved.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-af2-line px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setRotatingId(null);
                  setRotateValue("");
                }}
                className="rounded-lg border border-af2-line px-3 py-2 text-xs font-medium text-af2-ink-3 hover:bg-af2-paper-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleRotate(rotatingId)}
                disabled={submitting}
                className="rounded-lg bg-af2-ink px-3 py-2 text-sm font-medium text-white hover:bg-af2-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Rotate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
