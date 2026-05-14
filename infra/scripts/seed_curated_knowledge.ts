/**
 * Seed the autoflow_curated knowledge tier with AutoFlow's starter pack
 * (HEL-93). Run manually after migration 034 lands:
 *
 *   AUTOFLOW_STAFF_USER_IDS=<your-supabase-sub> \
 *   DATABASE_URL=postgres://... \
 *   npx ts-node infra/scripts/seed_curated_knowledge.ts
 *
 * Idempotent — uses `ON CONFLICT (title) DO NOTHING` after dedup-checking by
 * title. Re-running won't duplicate items.
 */

import { Pool } from "pg";
import { randomUUID } from "node:crypto";

interface CuratedSeed {
  title: string;
  content: string;
  tags: string[];
  kind: "document" | "verified";
}

const SEED_ITEMS: CuratedSeed[] = [
  {
    title: "AutoFlow product overview for agents",
    content:
      "AutoFlow is an AI agent orchestration platform. Each customer has a workspace; missions live inside workspaces; agents are assigned to missions; agents run routines that produce runs. Tools available to you depend on which integrations the workspace has connected. Always cite the source when you use information from memory.",
    tags: ["autoflow", "product", "orientation"],
    kind: "verified",
  },
  {
    title: "Citing sources in agent output",
    content:
      "When you use information from retrieved memory, cite the source so users can audit. Format: '(source: <item title or url>)' inline at the point of use. If multiple sources contributed, cite the strongest. Never invent citations.",
    tags: ["autoflow", "best-practice", "communication"],
    kind: "verified",
  },
  {
    title: "When to escalate to a human",
    content:
      "Escalate when: (1) the action is irreversible and outside your routine, (2) the customer asked something outside your mission, (3) you encounter a billing or compliance question, (4) you detect a security concern, (5) a connector returns an auth error you can't resolve. Use the escalation_request tool with a clear summary.",
    tags: ["autoflow", "best-practice", "hitl"],
    kind: "verified",
  },
  {
    title: "Save memory sparingly",
    content:
      "Use save_memory for observations that future agents will benefit from — durable patterns, customer preferences confirmed multiple times, learned constraints. Don't save: trivial observations, single-instance events, anything containing PII (the tool will refuse), full email bodies, or full chat logs. Better to forget than to remember noise.",
    tags: ["autoflow", "best-practice", "memory"],
    kind: "verified",
  },
  {
    title: "OAuth connector token refresh — common SOP",
    content:
      "If a connector tool returns 401/403, do not retry. Surface a 'reconnect needed' ticket via the create_ticket tool with the connector name. The workspace admin will get notified and re-authorize. Do not attempt to bypass the auth failure.",
    tags: ["autoflow", "connectors", "sop"],
    kind: "verified",
  },
  {
    title: "Budget-conscious LLM usage (BYOK)",
    content:
      "Most workspaces pay for their own LLM tokens (BYOK). Use the small tier for triage, classification, and short summaries. Use medium tier for normal agent reasoning. Reserve large tier (Opus/GPT-5) for high-stakes decisions or complex multi-step planning. Always summarize aggressively before saving to memory.",
    tags: ["autoflow", "byok", "cost"],
    kind: "verified",
  },
  {
    title: "Mission framing — start with structured prompts",
    content:
      "Every mission has free-text statement + four structured prompts (industry, target customer, success metric, runway). When you start work on a mission, read all five fields first. The structured prompts disambiguate the free-text and tell you what 'done' looks like.",
    tags: ["autoflow", "missions", "framing"],
    kind: "verified",
  },
  {
    title: "Working with humans in approval loops",
    content:
      "When a routine reaches an approval gate, write a concise summary (≤ 200 words) of what you're about to do + why + what's the worst case if it's wrong. Humans approve faster when they trust the summary. After approval, do exactly what was approved — no scope creep.",
    tags: ["autoflow", "approvals", "hitl"],
    kind: "verified",
  },
  {
    title: "Stop and ask if the mission is ambiguous",
    content:
      "Better to ask one clarifying question up front than to do the wrong thing and have to redo it. If the mission statement could reasonably mean two different things, escalate with both interpretations + your recommendation.",
    tags: ["autoflow", "best-practice"],
    kind: "verified",
  },
  {
    title: "Connector data freshness",
    content:
      "Knowledge_items with kind='connector_pull' may be stale. Check the source_ref timestamp — if older than 7 days for time-sensitive data (CRM, calendar, inbox), re-pull via the connector before using. Document data (Notion, Drive) typically stays valid longer.",
    tags: ["autoflow", "connectors", "data"],
    kind: "verified",
  },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    let inserted = 0;
    let skipped = 0;
    for (const seed of SEED_ITEMS) {
      const existing = await pool.query<{ id: string }>(
        "SELECT id FROM knowledge_items WHERE scope = 'autoflow_curated' AND title = $1 AND deleted_at IS NULL",
        [seed.title],
      );
      if ((existing.rowCount ?? 0) > 0) {
        console.log(`[skip] "${seed.title}" already exists (${existing.rows[0].id})`);
        skipped += 1;
        continue;
      }
      const id = randomUUID();
      await pool.query(
        `INSERT INTO knowledge_items
            (id, workspace_id, scope, kind, title, content, tags, metadata,
             source_type, trust_score)
          VALUES ($1, NULL, 'autoflow_curated', $2, $3, $4, $5, '{}'::jsonb, 'autoflow-curated', 0.95)`,
        [id, seed.kind, seed.title, seed.content, seed.tags],
      );
      console.log(`[ok] inserted "${seed.title}" (${id})`);
      inserted += 1;
    }
    console.log(`\nDone. Inserted ${inserted}, skipped ${skipped}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
