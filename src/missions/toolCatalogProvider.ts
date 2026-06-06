/**
 * Generation tool-catalog provider (HEL-760 / P5a).
 *
 * One read both mission-build and team-assembly call so the AI generation layer
 * can reason over Composio's catalog instead of a fixed ~15 connectors. It
 * returns:
 *   - `connected`: the workspace's ACTIVE Composio toolkits (usable right now);
 *   - `catalog`:   a bounded, keyword-searched slice of connectable toolkits the
 *                  workspace could add (excluding ones already connected).
 *
 * Toolkit-level granularity (not per-tool) keeps generation prompts bounded —
 * Composio exposes ~119 connectable toolkits / 1000s of tools, so callers pass
 * mission keywords as `search` and we never enumerate everything.
 *
 * Best-effort + flag-gated: returns `available:false` with empty lists when the
 * Composio broker is disabled, and NEVER throws — a broker/catalog hiccup must
 * not break generation; the caller falls back to its legacy behavior.
 */

import { isComposioEnabled } from "../integrations/composio/broker/config";
import { listConnections } from "../integrations/composio/broker/connectionService";
import { queryToolkitCatalog } from "../integrations/composio/broker/toolkitCatalog";

export interface ConnectedToolkit {
  /** Composio toolkit slug, e.g. "github". */
  slug: string;
  /** Display name when known (from the catalog); falls back to the slug. */
  name: string;
  status: "ACTIVE";
}

export interface CatalogToolkit {
  slug: string;
  name: string;
  description: string | null;
}

export interface GenerationToolCatalog {
  /** Toolkits the workspace has an ACTIVE connection for (ready to use now). */
  connected: ConnectedToolkit[];
  /** Searched, connectable toolkits NOT already connected (what could be added). */
  catalog: CatalogToolkit[];
  /** False when the Composio broker is disabled — callers fall back to legacy behavior. */
  available: boolean;
}

export interface LoadGenerationToolCatalogInput {
  workspaceId: string;
  userId: string;
  /** Mission keywords used to search the catalog (bounded result). */
  search?: string;
  /** Max catalog toolkits returned (excludes the connected ones). */
  catalogLimit?: number;
}

const DEFAULT_CATALOG_LIMIT = 40;
const EMPTY: GenerationToolCatalog = { connected: [], catalog: [], available: false };

export async function loadGenerationToolCatalog(
  input: LoadGenerationToolCatalogInput,
): Promise<GenerationToolCatalog> {
  if (!isComposioEnabled()) {
    return { ...EMPTY };
  }

  try {
    // Use listConnections (not the raw store) so out-of-band expiry/revocation is
    // reconciled against Composio before we mark a toolkit "connected" — reading
    // the store directly could expose a stale-ACTIVE row the workspace no longer
    // has, so generation would plan around a phantom-connected toolkit and
    // execution would fail later (HEL-760 review). listConnections is best-effort
    // and falls back to the local rows when the broker call fails.
    const rows = await listConnections({
      workspaceId: input.workspaceId,
      userId: input.userId,
    });
    const connectedSlugs = new Set<string>();
    for (const row of rows) {
      if (row.status === "ACTIVE") connectedSlugs.add(row.toolkit);
    }

    const page = await queryToolkitCatalog({
      search: input.search,
      connectableOnly: true,
      limit: input.catalogLimit ?? DEFAULT_CATALOG_LIMIT,
    });

    const nameBySlug = new Map<string, string>();
    for (const t of page.toolkits) nameBySlug.set(t.slug, t.name);

    const connected: ConnectedToolkit[] = Array.from(connectedSlugs).map((slug) => ({
      slug,
      name: nameBySlug.get(slug) ?? slug,
      status: "ACTIVE",
    }));

    const catalog: CatalogToolkit[] = page.toolkits
      .filter((t) => !connectedSlugs.has(t.slug))
      .map((t) => ({ slug: t.slug, name: t.name, description: t.description }));

    return { connected, catalog, available: true };
  } catch {
    // Best-effort — never let a broker/catalog failure break generation.
    return { ...EMPTY };
  }
}
