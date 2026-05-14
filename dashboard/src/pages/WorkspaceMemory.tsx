/**
 * Workspace Memory page (HEL-90 + HEL-92).
 *
 * Three-tab view over the three-layer memory model:
 *   - Instructions — CLAUDE.md-style markdown (HEL-92 editor inline)
 *   - Knowledge    — durable retrieval-backing facts (HEL-89 ranker behind /search)
 *   - Episodes     — append-only event log
 *
 * v1 ships read-only for Knowledge + Episodes plus full CRUD for
 * Instructions (the user-facing CLAUDE.md surface). The reflection trigger
 * lives on the Knowledge tab so admins can prompt synthesis on demand.
 *
 * Visual style follows the af2 token set: af2-paper background, af2-clay
 * accents, Fraunces for headings, Geist for body.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import {
  createInstruction,
  deleteInstruction,
  listInstructions,
  listKnowledgeItems,
  listEpisodes,
  runReflection,
  updateInstruction,
  type Episode,
  type Instruction,
  type KnowledgeItem,
} from "../api/memoryApi";

type Tab = "instructions" | "knowledge" | "episodes";

const TAB_LABELS: Record<Tab, string> = {
  instructions: "Instructions",
  knowledge: "Knowledge",
  episodes: "Episodes",
};

const TITLE_MAX = 200;
const BODY_MAX = 32_000;

export default function WorkspaceMemory() {
  const { requireAccessToken } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("instructions");

  return (
    <div className="min-h-screen bg-af2-paper text-af2-ink">
      <header className="border-b border-af2-line bg-af2-card px-8 py-6">
        <div className="text-xs uppercase tracking-[0.18em] text-af2-ink-2">Settings · Memory</div>
        <h1 className="mt-1 font-af2-serif text-3xl font-medium tracking-[-0.02em]">
          Workspace memory
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-af2-ink-2">
          What your agents read, write, and remember. Instructions are inlined into every agent
          on boot. Knowledge is retrieved when relevant. Episodes are the append-only log of what
          agents actually did.
        </p>
      </header>

      <nav className="border-b border-af2-line bg-af2-card px-8">
        <div className="flex gap-6">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={`relative py-3 text-sm font-medium transition ${
                activeTab === t
                  ? "text-af2-ink"
                  : "text-af2-ink-2 hover:text-af2-ink"
              }`}
            >
              {TAB_LABELS[t]}
              {activeTab === t ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-af2-clay" />
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      <main className="px-8 py-8">
        {activeTab === "instructions" ? (
          <InstructionsTab requireAccessToken={requireAccessToken} />
        ) : null}
        {activeTab === "knowledge" ? (
          <KnowledgeTab requireAccessToken={requireAccessToken} />
        ) : null}
        {activeTab === "episodes" ? (
          <EpisodesTab requireAccessToken={requireAccessToken} />
        ) : null}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Instructions tab (HEL-92 editor inline)
// ---------------------------------------------------------------------------

function InstructionsTab({
  requireAccessToken,
}: {
  requireAccessToken: () => Promise<string>;
}) {
  const [items, setItems] = useState<Instruction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Instruction | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const list = await listInstructions(token, { kind: "instruction" });
      setItems(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (editing || creating) {
    return (
      <InstructionsEditor
        existing={editing}
        onCancel={() => {
          setEditing(null);
          setCreating(false);
        }}
        onSaved={async () => {
          setEditing(null);
          setCreating(false);
          await refresh();
        }}
        requireAccessToken={requireAccessToken}
      />
    );
  }

  return (
    <section className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-af2-serif text-xl text-af2-ink">Workspace instructions</h2>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-md bg-af2-clay px-4 py-2 text-sm font-medium text-af2-paper transition hover:bg-af2-clay/90"
        >
          <Plus className="h-4 w-4" />
          New instruction
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-af2-ink-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-md border border-af2-clay/40 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay">
          {error}
        </div>
      ) : null}

      {!loading && items.length === 0 ? (
        <div className="rounded-md border border-dashed border-af2-line bg-af2-card p-8 text-center">
          <p className="font-af2-serif text-base text-af2-ink-2">
            No instructions yet. These are like CLAUDE.md for your agents — drop in workspace-wide
            preferences, escalation rules, anything every agent should know on boot.
          </p>
        </div>
      ) : null}

      <ul className="space-y-2.5">
        {items.map((it) => (
          <li
            key={it.id}
            className="rounded-md border border-af2-line bg-af2-card p-4 transition hover:border-af2-line-2"
          >
            <div className="flex items-baseline justify-between gap-4">
              <button
                type="button"
                onClick={() => setEditing(it)}
                className="text-left"
              >
                <h3 className="font-af2-serif text-lg text-af2-ink">{it.title}</h3>
                <p className="mt-1 text-xs text-af2-ink-2">
                  v{it.version} · updated {new Date(it.updatedAt).toLocaleString()}
                  {it.missionId ? " · mission-scoped" : ""}
                </p>
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`Delete "${it.title}"?`)) return;
                  try {
                    const token = await requireAccessToken();
                    await deleteInstruction(it.id, token);
                    await refresh();
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
                className="rounded-md border border-af2-line p-2 text-af2-ink-2 transition hover:border-af2-clay hover:text-af2-clay"
                aria-label="Delete instruction"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// HEL-92 editor — split-pane markdown source + plain-text preview.
function InstructionsEditor({
  existing,
  onCancel,
  onSaved,
  requireAccessToken,
}: {
  existing: Instruction | null;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
  requireAccessToken: () => Promise<string>;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenEstimate = useMemo(() => Math.ceil(body.length / 4), [body]);
  const overBudget = tokenEstimate > 8000;

  const canSave =
    title.trim().length > 0 &&
    title.length <= TITLE_MAX &&
    body.trim().length > 0 &&
    body.length <= BODY_MAX &&
    !saving;

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-af2-serif text-xl text-af2-ink">
          {existing ? "Edit instruction" : "New instruction"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-af2-ink-2 hover:text-af2-ink"
        >
          Cancel
        </button>
      </div>

      <label className="mb-4 block">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-af2-ink-2">Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TITLE_MAX}
          className="mt-1 w-full rounded-md border border-af2-line-2 bg-af2-card px-4 py-2 text-base text-af2-ink outline-none focus:border-af2-clay focus:ring-2 focus:ring-af2-clay/20"
          placeholder="e.g. How we handle escalations"
        />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-af2-ink-2">
            Markdown source
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={24}
            maxLength={BODY_MAX}
            className="mt-1 w-full resize-y rounded-md border border-af2-line-2 bg-af2-card p-4 font-af2-mono text-sm leading-relaxed text-af2-ink outline-none focus:border-af2-clay focus:ring-2 focus:ring-af2-clay/20"
            placeholder="# How we handle escalations&#10;&#10;Always escalate to a human when ..."
          />
        </label>
        <div className="block">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-af2-ink-2">
            Preview (raw)
          </span>
          <pre className="mt-1 whitespace-pre-wrap rounded-md border border-af2-line-2 bg-af2-paper p-4 font-af2-serif text-sm leading-relaxed text-af2-ink min-h-[24rem] overflow-y-auto">
            {body || "(empty)"}
          </pre>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-af2-ink-2">
        <div>
          {body.length.toLocaleString()} / {BODY_MAX.toLocaleString()} chars ·
          {" "}
          <span className={overBudget ? "text-af2-clay" : ""}>~{tokenEstimate.toLocaleString()} tokens</span>
          {overBudget ? " (over the 8K boot-context budget)" : ""}
        </div>
        {existing ? <div>v{existing.version} → v{existing.version + 1}</div> : null}
      </div>

      {error ? (
        <div role="alert" className="mt-4 rounded-md border border-af2-clay/40 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay">
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-af2-line px-5 py-2 text-sm font-medium text-af2-ink transition hover:border-af2-line-2"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              const token = await requireAccessToken();
              if (existing) {
                await updateInstruction(existing.id, { title, body }, token);
              } else {
                await createInstruction({ title, body, kind: "instruction" }, token);
              }
              await onSaved();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setSaving(false);
            }
          }}
          className="inline-flex items-center gap-2 rounded-md bg-af2-clay px-5 py-2 text-sm font-medium text-af2-paper transition hover:bg-af2-clay/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {existing ? "Save new version" : "Create instruction"}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Knowledge tab (read-only list + reflection trigger)
// ---------------------------------------------------------------------------

function KnowledgeTab({
  requireAccessToken,
}: {
  requireAccessToken: () => Promise<string>;
}) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reflecting, setReflecting] = useState(false);
  const [reflectionMessage, setReflectionMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const list = await listKnowledgeItems(token, { limit: 100 });
      setItems(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-af2-serif text-xl text-af2-ink">Knowledge items</h2>
        <button
          type="button"
          onClick={async () => {
            setReflecting(true);
            setReflectionMessage(null);
            try {
              const token = await requireAccessToken();
              const result = await runReflection(token, { lookbackDays: 14 });
              setReflectionMessage(
                `Reflection complete: ${result.clustersFound} clusters → ${result.itemsCreated} new items (${result.episodesProcessed} episodes processed)`,
              );
              await refresh();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setReflecting(false);
            }
          }}
          disabled={reflecting}
          className="inline-flex items-center gap-2 rounded-md border border-af2-clay/50 bg-af2-clay-soft/40 px-4 py-2 text-sm font-medium text-af2-clay transition hover:bg-af2-clay-soft/60 disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {reflecting ? "Running…" : "Run consolidation"}
        </button>
      </div>

      {reflectionMessage ? (
        <div className="mb-4 rounded-md border border-af2-clay/40 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay">
          {reflectionMessage}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-af2-ink-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-md border border-af2-clay/40 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay">
          {error}
        </div>
      ) : null}

      {!loading && items.length === 0 ? (
        <div className="rounded-md border border-dashed border-af2-line bg-af2-card p-8 text-center">
          <p className="font-af2-serif text-base text-af2-ink-2">
            No knowledge items yet. Items appear here as agents save observations, run consolidation
            synthesizes patterns from episodes, or you upload documents.
          </p>
        </div>
      ) : null}

      <ul className="space-y-2.5">
        {items.map((it) => (
          <li
            key={it.id}
            className="rounded-md border border-af2-line bg-af2-card p-4 transition hover:border-af2-line-2"
          >
            <div className="flex items-baseline justify-between gap-4">
              <div className="flex-1">
                <h3 className="font-af2-serif text-base text-af2-ink">{it.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-af2-ink-2">{it.content}</p>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-af2-ink-2">
                  <span className="rounded bg-af2-paper px-2 py-0.5">{it.kind}</span>
                  <span className="rounded bg-af2-paper px-2 py-0.5">trust {(it.trustScore * 100).toFixed(0)}%</span>
                  {it.sourceEpisodeIds.length > 0 ? (
                    <span className="rounded bg-af2-paper px-2 py-0.5">
                      {it.sourceEpisodeIds.length} citation{it.sourceEpisodeIds.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  <span>· updated {new Date(it.updatedAt).toLocaleString()}</span>
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Episodes tab (read-only chronological log)
// ---------------------------------------------------------------------------

function EpisodesTab({
  requireAccessToken,
}: {
  requireAccessToken: () => Promise<string>;
}) {
  const [items, setItems] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const list = await listEpisodes(token, { limit: 100 });
      setItems(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-baseline justify-between">
        <h2 className="font-af2-serif text-xl text-af2-ink">Recent episodes</h2>
        <span className="text-xs text-af2-ink-2">
          Append-only log · {items.length === 100 ? "showing newest 100" : `${items.length} total`}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-af2-ink-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-md border border-af2-clay/40 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay">
          {error}
        </div>
      ) : null}

      {!loading && items.length === 0 ? (
        <div className="rounded-md border border-dashed border-af2-line bg-af2-card p-8 text-center">
          <p className="font-af2-serif text-base text-af2-ink-2">
            No episodes yet. Agents write episodes via save_memory each time they observe something,
            complete a tool call, or reflect at end of run.
          </p>
        </div>
      ) : null}

      <ul className="space-y-2.5">
        {items.map((ep) => (
          <li
            key={ep.id}
            className="rounded-md border border-af2-line bg-af2-card p-4"
          >
            <div className="flex items-baseline justify-between gap-4">
              <div className="flex-1">
                <h3 className="font-af2-serif text-base text-af2-ink">{ep.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-af2-ink-2">{ep.summary}</p>
              </div>
              <span className="shrink-0 rounded bg-af2-paper px-2 py-1 text-xs text-af2-ink-2">
                {ep.episodeType}
              </span>
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-af2-ink-2">
              {new Date(ep.createdAt).toLocaleString()}
              {ep.reflectedAt ? <span>· reflected</span> : <span>· awaiting reflection</span>}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
