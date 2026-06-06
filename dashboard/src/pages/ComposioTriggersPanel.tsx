import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/ToastProvider";
import { listAgents, type Agent } from "../api/agentApi";
import {
  listComposioTriggers,
  listComposioTriggerTypes,
  getComposioTriggerType,
  createComposioTrigger,
  deleteComposioTrigger,
  type ComposioTriggerInstance,
  type ComposioTriggerTypeSummary,
} from "../api/composioTriggersApi";

/**
 * ComposioTriggersPanel — the Triggers tab (HEL-768 / P4-d). Dual-source picker:
 * a "Composio" flow (pick toolkit → trigger type → config → agent → subscribe;
 * list + remove) and a "Scheduled (native)" note that points at routines (some
 * routines won't have a Composio trigger). Reuses the af2 .int-row/.btn/.pill
 * classes (no new CSS), mirroring ComposioConnectionsPanel.
 */

type Source = "composio" | "native";

export default function ComposioTriggersPanel() {
  const { getAccessToken } = useAuth();
  const toast = useToast();

  const [source, setSource] = useState<Source>("composio");
  const [triggers, setTriggers] = useState<ComposioTriggerInstance[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-trigger form state.
  const [toolkit, setToolkit] = useState("");
  const [types, setTypes] = useState<ComposioTriggerTypeSummary[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [slug, setSlug] = useState("");
  const [agentId, setAgentId] = useState("");
  const [configText, setConfigText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyTriggerId, setBusyTriggerId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      const [t, a] = await Promise.all([listComposioTriggers(token), listAgents(token)]);
      setTriggers(t);
      setAgents(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load triggers");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadTypes = useCallback(
    async (tk: string) => {
      if (!tk.trim()) {
        setTypes([]);
        return;
      }
      setTypesLoading(true);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Not authenticated");
        setTypes(await listComposioTriggerTypes(token, tk.trim()));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't load trigger types");
        setTypes([]);
      } finally {
        setTypesLoading(false);
      }
    },
    [getAccessToken, toast],
  );

  const onPickType = useCallback(
    async (s: string) => {
      setSlug(s);
      if (!s) {
        setConfigText("");
        return;
      }
      try {
        const token = await getAccessToken();
        if (!token) return;
        const type = await getComposioTriggerType(token, s);
        // Prefill the config textarea with the schema's property keys as a hint.
        const props = (type.config as { properties?: Record<string, unknown> }).properties ?? {};
        const skeleton = Object.fromEntries(Object.keys(props).map((k) => [k, ""]));
        setConfigText(Object.keys(skeleton).length ? JSON.stringify(skeleton, null, 2) : "");
      } catch {
        // The config hint is best-effort; subscribing still works without it.
      }
    },
    [getAccessToken],
  );

  const onSubscribe = useCallback(async () => {
    if (!toolkit.trim() || !slug || !agentId) {
      toast.error("Pick a toolkit, a trigger, and an agent.");
      return;
    }
    let triggerConfig: Record<string, unknown> | undefined;
    if (configText.trim()) {
      try {
        triggerConfig = JSON.parse(configText) as Record<string, unknown>;
      } catch {
        toast.error("Trigger config must be valid JSON.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      await createComposioTrigger(token, { toolkit: toolkit.trim(), slug, agentId, triggerConfig });
      toast.success("Trigger subscribed.");
      setSlug("");
      setConfigText("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't subscribe the trigger");
    } finally {
      setSubmitting(false);
    }
  }, [toolkit, slug, agentId, configText, getAccessToken, toast, load]);

  const onDelete = useCallback(
    async (triggerId: string) => {
      setBusyTriggerId(triggerId);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Not authenticated");
        await deleteComposioTrigger(token, triggerId);
        setTriggers((prev) => prev.filter((t) => t.triggerId !== triggerId));
        toast.success("Trigger removed.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't remove the trigger");
      } finally {
        setBusyTriggerId(null);
      }
    },
    [getAccessToken, toast],
  );

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  return (
    <div>
      <div className="filterbar" role="tablist" aria-label="Trigger source">
        <button
          type="button"
          className={`btn sm ${source === "composio" ? "primary" : "ghost"}`}
          onClick={() => setSource("composio")}
        >
          Composio
        </button>
        <button
          type="button"
          className={`btn sm ${source === "native" ? "primary" : "ghost"}`}
          onClick={() => setSource("native")}
        >
          Scheduled (native)
        </button>
      </div>

      {source === "native" ? (
        <div className="card">
          <p className="desc">
            Native scheduled triggers run on a cron schedule and are configured as routines — use
            these for work Composio can&apos;t back. <Link to="/routines">Manage routines →</Link>
          </p>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="int-name" style={{ marginBottom: 8 }}>
              New Composio trigger
            </div>
            <div className="filterbar">
              <input
                className="grow"
                placeholder="Toolkit slug (e.g. github)"
                aria-label="Toolkit"
                value={toolkit}
                onChange={(e) => setToolkit(e.target.value)}
                onBlur={() => void loadTypes(toolkit)}
              />
              <select
                aria-label="Trigger type"
                value={slug}
                onChange={(e) => void onPickType(e.target.value)}
                disabled={typesLoading || types.length === 0}
              >
                <option value="">
                  {typesLoading ? "Loading…" : types.length ? "Select a trigger…" : "Enter a toolkit first"}
                </option>
                {types.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select aria-label="Agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Select an agent…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              aria-label="Trigger config (JSON)"
              placeholder="Trigger config (JSON, optional)"
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              rows={4}
              style={{ width: "100%", marginTop: 8, fontFamily: "monospace", fontSize: 12 }}
            />
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn primary sm"
                disabled={submitting}
                onClick={() => void onSubscribe()}
              >
                {submitting ? "Subscribing…" : "Subscribe trigger"}
              </button>
            </div>
          </div>

          {error ? (
            <div className="card">
              <p className="desc">{error}</p>
              <button type="button" className="btn sm" onClick={() => void load()}>
                Retry
              </button>
            </div>
          ) : loading ? (
            <p className="desc">Loading triggers…</p>
          ) : triggers.length === 0 ? (
            <p className="desc">No triggers yet. Subscribe one above.</p>
          ) : (
            <div>
              {triggers.map((t) => (
                <div className="int-row" key={t.triggerId}>
                  <div>
                    <div className="int-name">{t.triggerSlug}</div>
                    <div className="int-desc">
                      {t.toolkit} · wakes {agentName(t.agentId)}
                    </div>
                  </div>
                  <span className={`pill dot ${t.status === "ENABLED" ? "sage" : "mustard"}`}>
                    {t.status}
                  </span>
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={busyTriggerId === t.triggerId}
                    onClick={() => void onDelete(t.triggerId)}
                  >
                    {busyTriggerId === t.triggerId ? "…" : "Remove"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
