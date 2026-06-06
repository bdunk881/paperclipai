import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/ToastProvider";
import {
  fetchComposioToolkits,
  listComposioConnections,
  startComposioConnect,
  disconnectComposio,
  type ComposioToolkit,
  type ComposioConnection,
} from "../api/composioApi";

/**
 * ComposioConnectionsPanel — the Integrations tab, powered by the Composio
 * broker (HEL-747 / P2b-2). Replaces the bespoke ~15-connector grid with a
 * search over Composio's full connectable-app catalog (P2a) joined with this
 * workspace's connected accounts (P1c). Connect (P1b) / disconnect (P1c) wire
 * straight to the broker.
 *
 * UX (Brad's calls): search + load-more (the catalog cursor), and only
 * connectable-via-managed-auth toolkits (the endpoint filters via connectable).
 */

const PAGE_SIZE = 30;

export default function ComposioConnectionsPanel() {
  const { getAccessToken } = useAuth();
  const toast = useToast();

  const [toolkits, setToolkits] = useState<ComposioToolkit[]>([]);
  const [connectionBySlug, setConnectionBySlug] = useState<Record<string, ComposioConnection>>({});
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  // OAuth round-trip result: the backend callback redirects back here with
  // ?status=success|error&provider=composio&message=…; toast + scrub. Provider-
  // agnostic, mirroring the old panel.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const provider = params.get("provider");
    if (!status || !provider) return;
    if (status === "success") {
      toast.success(`${provider} connected`);
    } else {
      toast.error(params.get("message") ?? `Couldn't connect ${provider}`);
    }
    params.delete("status");
    params.delete("provider");
    params.delete("message");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(
    async (opts: { search: string; cursor?: string | null }) => {
      const append = Boolean(opts.cursor);
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Not authenticated");
        const [page, connections] = await Promise.all([
          fetchComposioToolkits(token, {
            search: opts.search || undefined,
            connectableOnly: true,
            limit: PAGE_SIZE,
            cursor: opts.cursor ?? undefined,
          }),
          append ? Promise.resolve(null) : listComposioConnections(token),
        ]);
        setToolkits((prev) => (append ? [...prev, ...page.toolkits] : page.toolkits));
        setCursor(page.nextCursor);
        setTotal(page.total);
        if (connections) {
          const map: Record<string, ComposioConnection> = {};
          for (const c of connections) {
            // prefer an ACTIVE connection when a toolkit has more than one.
            if (!map[c.toolkit] || c.status === "ACTIVE") map[c.toolkit] = c;
          }
          setConnectionBySlug(map);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load integrations");
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [getAccessToken],
  );

  // Initial load + debounced search.
  useEffect(() => {
    const handle = setTimeout(() => void load({ search }), search ? 250 : 0);
    return () => clearTimeout(handle);
  }, [search, load]);

  const onConnect = useCallback(
    async (slug: string) => {
      setBusySlug(slug);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Not authenticated");
        const { redirectUrl } = await startComposioConnect(token, slug);
        if (redirectUrl) {
          window.location.assign(redirectUrl);
          return;
        }
        toast.info("Connection started.");
        await load({ search });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't start the connection");
      } finally {
        setBusySlug(null);
      }
    },
    [getAccessToken, toast, load, search],
  );

  const onDisconnect = useCallback(
    async (slug: string, connectedAccountId: string) => {
      setBusySlug(slug);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Not authenticated");
        await disconnectComposio(token, connectedAccountId);
        toast.success("Disconnected.");
        setConnectionBySlug((prev) => {
          const next = { ...prev };
          delete next[slug];
          return next;
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't disconnect");
      } finally {
        setBusySlug(null);
      }
    },
    [getAccessToken, toast],
  );

  return (
    <div>
      <div className="filterbar">
        <input
          className="grow"
          type="search"
          placeholder="Search apps…"
          aria-label="Search integrations"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error ? (
        <div className="card">
          <p className="desc">{error}</p>
          <button className="btn sm" onClick={() => void load({ search })}>
            Retry
          </button>
        </div>
      ) : loading ? (
        <p className="desc">Loading integrations…</p>
      ) : toolkits.length === 0 ? (
        <p className="desc">No apps found{search ? ` for “${search}”` : ""}.</p>
      ) : (
        <div>
          {toolkits.map((toolkit) => {
            const connection = connectionBySlug[toolkit.slug];
            const connected = connection?.status === "ACTIVE";
            const expired = connection?.status === "EXPIRED";
            const busy = busySlug === toolkit.slug;
            return (
              <div className="int-row" key={toolkit.slug}>
                <div className="int-logo">
                  {toolkit.logo ? (
                    <img
                      src={toolkit.logo}
                      alt=""
                      width={28}
                      height={28}
                      loading="lazy"
                      style={{ borderRadius: 6 }}
                    />
                  ) : (
                    toolkit.name.slice(0, 1)
                  )}
                </div>
                <div>
                  <div className="int-name">{toolkit.name}</div>
                  <div className="int-desc">
                    {toolkit.description ??
                      `${toolkit.toolsCount ?? 0} tools${
                        toolkit.triggersCount ? ` · ${toolkit.triggersCount} triggers` : ""
                      }`}
                  </div>
                </div>
                {connected ? (
                  <span className="pill dot sage">Connected</span>
                ) : expired ? (
                  <span className="pill dot mustard">Expired</span>
                ) : (
                  <span />
                )}
                {connected ? (
                  <button
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() => void onDisconnect(toolkit.slug, connection!.connectedAccountId)}
                  >
                    {busy ? "…" : "Disconnect"}
                  </button>
                ) : (
                  <button
                    className="btn primary sm"
                    disabled={busy}
                    onClick={() => void onConnect(toolkit.slug)}
                  >
                    {busy ? "…" : expired ? "Reconnect" : "Connect"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {cursor && !loading ? (
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <button className="btn ghost" disabled={loadingMore} onClick={() => void load({ search, cursor })}>
            {loadingMore ? "Loading…" : `Load more (${toolkits.length} of ${total})`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
