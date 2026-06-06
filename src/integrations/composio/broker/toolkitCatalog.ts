/**
 * toolkitCatalog — Composio toolkit catalog, surfaced through our API (HEL-745 / P2a).
 *
 * The catalog of connectable apps (Composio's "toolkits"). `composio.toolkits.get()`
 * returns a BARE ARRAY (no server-side cursor), so we fetch the full list ONCE,
 * cache it in-process with a TTL, and do search / category-filter / pagination
 * ourselves. This is the feed the new Connections tab (P2b) renders, with the
 * per-workspace connection status (P1c) overlaid by slug.
 *
 * Auth metadata (`authSchemes` / `composioManagedAuthSchemes` / `noAuth`) is
 * exposed per entry so the UI can badge which toolkits are connectable via
 * managed auth today vs. via our own OAuth apps later (P6).
 */

import { isComposioEnabled } from "./config";
import { getComposioBroker } from "./client";

export interface ToolkitCategory {
  slug: string;
  name: string;
}

export interface ToolkitCatalogEntry {
  slug: string;
  name: string;
  logo: string | null;
  description: string | null;
  categories: ToolkitCategory[];
  toolsCount: number | null;
  triggersCount: number | null;
  authSchemes: string[];
  composioManagedAuthSchemes: string[];
  noAuth: boolean;
}

export interface ToolkitCatalogQuery {
  search?: string;
  category?: string;
  cursor?: string;
  limit?: number;
}

export interface ToolkitCatalogPage {
  toolkits: ToolkitCatalogEntry[];
  total: number;
  nextCursor: string | null;
}

/** Structural view of a raw Composio toolkit item (avoids a static SDK import). */
interface RawToolkitItem {
  slug: string;
  name: string;
  meta?: {
    logo?: string;
    description?: string;
    categories?: { slug: string; name: string }[];
    toolsCount?: number;
    triggersCount?: number;
  };
  authSchemes?: string[];
  composioManagedAuthSchemes?: string[];
  noAuth?: boolean;
}

const TTL_MS = 60 * 60 * 1000; // refresh the catalog hourly
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

interface CachedCatalog {
  entries: ToolkitCatalogEntry[];
  fetchedAt: number;
}

// Process-local cache of the (global, non-tenant) toolkit catalog. Not a Map —
// a single snapshot + timestamp; refreshed on TTL expiry.
let cache: CachedCatalog | null = null;

function normalizeToolkitItem(item: RawToolkitItem): ToolkitCatalogEntry {
  const meta = item.meta ?? {};
  return {
    slug: item.slug,
    name: item.name,
    logo: meta.logo ?? null,
    description: meta.description ?? null,
    categories: (meta.categories ?? []).map((c) => ({ slug: c.slug, name: c.name })),
    toolsCount: meta.toolsCount ?? null,
    triggersCount: meta.triggersCount ?? null,
    authSchemes: item.authSchemes ?? [],
    composioManagedAuthSchemes: item.composioManagedAuthSchemes ?? [],
    noAuth: item.noAuth ?? false,
  };
}

/**
 * Load (and cache) the full toolkit catalog. One Composio call — the response is
 * a bare array (no cursor), so a single fetch returns the catalog for the filter.
 */
export async function loadCatalog(force = false): Promise<ToolkitCatalogEntry[]> {
  if (!force && cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.entries;
  }

  const composio = await getComposioBroker();
  const raw = (await composio.toolkits.get({
    managedBy: "all",
    sortBy: "alphabetically",
  })) as unknown as RawToolkitItem[];

  const entries = (Array.isArray(raw) ? raw : []).map(normalizeToolkitItem);
  cache = { entries, fetchedAt: Date.now() };
  return entries;
}

function parseOffset(cursor?: string): number {
  const n = Number(cursor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function clampLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/** Search/filter/paginate the cached catalog into a single page. */
export async function queryToolkitCatalog(query: ToolkitCatalogQuery): Promise<ToolkitCatalogPage> {
  const all = await loadCatalog();

  const search = query.search?.trim().toLowerCase();
  const category = query.category?.trim().toLowerCase();

  let filtered = all;
  if (category) {
    filtered = filtered.filter((t) =>
      t.categories.some(
        (c) => c.slug.toLowerCase() === category || c.name.toLowerCase() === category,
      ),
    );
  }
  if (search) {
    filtered = filtered.filter(
      (t) =>
        t.slug.toLowerCase().includes(search) ||
        t.name.toLowerCase().includes(search) ||
        (t.description?.toLowerCase().includes(search) ?? false),
    );
  }

  const total = filtered.length;
  const limit = clampLimit(query.limit);
  const offset = parseOffset(query.cursor);
  const toolkits = filtered.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const nextCursor = nextOffset < total ? String(nextOffset) : null;

  return { toolkits, total, nextCursor };
}

/** True only when the broker is configured (the catalog comes from the live API). */
export function isToolkitCatalogAvailable(): boolean {
  return isComposioEnabled();
}

/** Test-only: clear the cached catalog. */
export function resetToolkitCatalogForTests(): void {
  cache = null;
}
