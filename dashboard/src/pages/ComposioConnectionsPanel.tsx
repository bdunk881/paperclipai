import { useCallback, useEffect, useMemo, useState } from "react";
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
 * broker (HEL-747). Replaces the bespoke ~15-connector grid with a search over
 * Composio's full connectable-app catalog (P2a) joined with this workspace's
 * connected accounts (P1c). Connect (P1b) / disconnect (P1c) wire straight to
 * the broker.
 *
 * HEL-748: category filter + grouping. A category <select> (server-side
 * `?category=`); in the "All" view the loaded toolkits are grouped by their
 * primary category. Category options accumulate across loaded pages.
 */

const PAGE_SIZE = 60;

function primaryCategory(toolkit: ComposioToolkit): { slug: string; name: string } {
  return toolkit.categories[0] ?? { slug: "other", name: "Other" };
}

export default function ComposioConnectionsPanel() {
  const { getAccessToken } = useAuth();
  const toast = useToast();

  const [toolkits, setToolkits] = useState<ComposioToolkit[]>([]);
  const [connectionBySlug, setConnectionBySlug] = useState<Record<string, ComposioConnection>>({});
  const [seenCategories, setSeenCategories] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  // OAuth round-trip result: the backend callback redirects back here with
  // ?status=success|error&provider=composio&message=…; toast + scrub.
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
    async (opts: { search: string; category: string; cursor?: string | null }) => {
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
            category: opts.category || undefined,
            connectableOnly: true,
            limit: PAGE_SIZE,
            cursor: opts.cursor ?? undefined,
          }),
          append ? Promise.resolve(null) : listComposioConnections(token),
        ]);
        setToolkits((prev) => (append ? [...prev, ...page.toolkits] : page.toolkits));
        setCursor(page.nextCursor);
        setTotal(page.total);
        // Accumulate the category options so the filter stays complete even after
        // narrowing to one category (the loaded set shrinks, the options don't).
        setSeenCategories((prev) => {
          const next = { ...prev };
          for (const t of page.toolkits) for (const c of t.categories) next[c.slug] = c.name;
          return next;
        });
        if (connections) {
          const map: Record<string, ComposioConnection> = {};
          for (const c of connections) {
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

  // Initial load + reload on search (debounced) or category change.
  useEffect(() => {
    const handle = setTimeout(() => void load({ search, category }), search ? 250 : 0);
    return () => clearTimeout(handle);
  }, [search, category, load]);

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
        await load({ search, category });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't start the connection");
      } finally {
        setBusySlug(null);
      }
    },
    [getAccessToken, toast, load, search, category],
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

  const categoryOptions = useMemo(
    () =>
      Object.entries(seenCategories)
        .map(([slug, name]) => ({ slug, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [seenCategories],
  );

  // Group the loaded toolkits by primary category for the "All" view. When a
  // category is selected the list is already server-filtered, so render flat.
  const groups = useMemo(() => {
    if (category) return null;
    const map = new Map<string, { name: string; items: ComposioToolkit[] }>();
    for (const toolkit of toolkits) {
      const cat = primaryCategory(toolkit);
      const group = map.get(cat.slug) ?? { name: cat.name, items: [] };
      group.items.push(toolkit);
      map.set(cat.slug, group);
    }
    return [...map.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([slug, group]) => ({ slug, name: group.name, items: group.items }));
  }, [toolkits, category]);

  function renderRow(toolkit: ComposioToolkit) {
    const connection = connectionBySlug[toolkit.slug];
    const connected = connection?.status === "ACTIVE";
    const expired = connection?.status === "EXPIRED";
    const busy = busySlug === toolkit.slug;
    const cat = primaryCategory(toolkit);
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
            {toolkit.description ?? `${toolkit.toolsCount ?? 0} tools`}
            {cat.name ? <span style={{ opacity: 0.55 }}> · {cat.name}</span> : null}
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
  }

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
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categoryOptions.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="card">
          <p className="desc">{error}</p>
          <button className="btn sm" onClick={() => void load({ search, category })}>
            Retry
          </button>
        </div>
      ) : loading ? (
        <p className="desc">Loading integrations…</p>
      ) : toolkits.length === 0 ? (
        <p className="desc">No apps found{search ? ` for “${search}”` : ""}.</p>
      ) : groups ? (
        <div>
          {groups.map((group) => (
            <div key={group.slug}>
              <div className="int-cat">{group.name}</div>
              {group.items.map(renderRow)}
            </div>
          ))}
        </div>
      ) : (
        <div>{toolkits.map(renderRow)}</div>
      )}

      {cursor && !loading ? (
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <button
            className="btn ghost"
            disabled={loadingMore}
            onClick={() => void load({ search, category, cursor })}
          >
            {loadingMore ? "Loading…" : `Load more (${toolkits.length} of ${total})`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
