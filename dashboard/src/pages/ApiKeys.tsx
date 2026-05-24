import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  type ApiKeyRecord,
  type ApiKeySecretResponse,
} from "../api/client";
import { useAuth } from "../context/AuthContext";
// HEL-214 / PR J: Pro Mode actionable reveal.
import { ProReveal } from "../components/pro/ProReveal";
import { ApiExplorer } from "../components/pro/ApiExplorer";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function statusFor(key: ApiKeyRecord): { label: string; className: string } {
  if (key.revokedAt) {
    return {
      label: "Revoked",
      className: "border-af2-line bg-af2-paper-2 text-af2-ink-3",
    };
  }
  return {
    label: "Active",
    className: "border-af2-sage/30 bg-af2-sage/15 text-af2-sage",
  };
}

export default function ApiKeys() {
  const { requireAccessToken } = useAuth();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [secretResponse, setSecretResponse] = useState<ApiKeySecretResponse | null>(null);

  const activeCount = useMemo(
    () => keys.filter((key) => !key.revokedAt).length,
    [keys],
  );

  const loadKeys = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const accessToken = await requireAccessToken();
      setKeys(await listApiKeys(accessToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      const result = await createApiKey({ name: trimmed }, accessToken);
      setSecretResponse(result);
      setName("");
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRotate(key: ApiKeyRecord) {
    setSubmitting(true);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      const result = await rotateApiKey(key.id, accessToken);
      setSecretResponse(result);
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate API key");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(key: ApiKeyRecord) {
    setSubmitting(true);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      await revokeApiKey(key.id, accessToken);
      await loadKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke API key");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="af2-page" style={{ maxWidth: 980 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Settings / API</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>API Keys</h1>
          <div className="af2-page-head-meta">
            Manage workspace keys for programmatic AutoFlow access.
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-af2-clay/30 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {secretResponse && (
        <div className="mb-4 rounded-lg border border-af2-sage/30 bg-af2-sage/10 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={18} className="mt-0.5 text-af2-sage" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-af2-ink">
                New key for {secretResponse.key.name}
              </p>
              <input
                readOnly
                value={secretResponse.secret}
                aria-label="New API key secret"
                className="mt-3 w-full rounded-lg border border-af2-line bg-af2-card px-3 py-2 font-mono text-sm text-af2-ink"
                onFocus={(event) => event.currentTarget.select()}
              />
              <p className="mt-2 text-xs text-af2-ink-3">
                This secret is shown once. Future views only show {secretResponse.key.maskedKey}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSecretResponse(null)}
              className="rounded-lg border border-af2-line px-3 py-1.5 text-xs font-medium text-af2-ink-3 hover:bg-af2-paper-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <section className="rounded-xl border border-af2-line bg-af2-card">
          <div className="flex items-center justify-between border-b border-af2-line px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-af2-ink">Workspace keys</h2>
              <p className="mt-1 text-xs text-af2-ink-3">
                {activeCount} active / {keys.length} total
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadKeys()}
              className="inline-flex items-center gap-2 rounded-lg border border-af2-line px-3 py-2 text-xs font-medium text-af2-ink-3 hover:bg-af2-paper-2"
              disabled={loading}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-sm text-af2-ink-3">Loading keys...</div>
          ) : keys.length === 0 ? (
            <div className="px-5 py-10 text-sm text-af2-ink-3">No API keys yet.</div>
          ) : (
            <div className="divide-y divide-af2-line">
              {keys.map((key) => {
                const status = statusFor(key);
                const disabled = submitting || Boolean(key.revokedAt);
                return (
                  <div key={key.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-af2-ink">{key.name}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}>
                          {status.label}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-af2-ink-3">{key.maskedKey}</p>
                      <p className="mt-2 text-xs text-af2-ink-4">
                        Created {formatDate(key.createdAt)} / Last used {formatDate(key.lastUsedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRotate(key)}
                        disabled={disabled}
                        aria-label={`Rotate ${key.name}`}
                        className="inline-flex items-center gap-2 rounded-lg border border-af2-line px-3 py-2 text-xs font-medium text-af2-ink-3 hover:bg-af2-paper-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RefreshCw size={14} />
                        Rotate
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRevoke(key)}
                        disabled={disabled}
                        aria-label={`Revoke ${key.name}`}
                        className="inline-flex items-center gap-2 rounded-lg border border-af2-line px-3 py-2 text-xs font-medium text-af2-clay hover:bg-af2-clay-soft/30 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        Revoke
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="rounded-xl border border-af2-line bg-af2-card p-5">
          <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-af2-clay-soft text-af2-clay">
            <KeyRound size={18} />
          </div>
          <h2 className="text-sm font-semibold text-af2-ink">Create key</h2>
          <form onSubmit={handleCreate} className="mt-4 space-y-3">
            <label className="block text-xs font-medium text-af2-ink-3" htmlFor="api-key-name">
              Name
            </label>
            <input
              id="api-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Production automation"
              className="w-full rounded-lg border border-af2-line bg-af2-card px-3 py-2 text-sm text-af2-ink outline-none focus:border-af2-clay"
            />
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-af2-ink px-3 py-2 text-sm font-medium text-white hover:bg-af2-ink-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus size={14} />
              Create key
            </button>
          </form>
        </aside>
      </div>
      <ProReveal
        label="API explorer"
        description="Generate a scoped token and copy ready-to-run curl + JS snippets."
      >
        <ApiExplorer />
      </ProReveal>
    </div>
  );
}
