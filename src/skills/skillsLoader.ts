/**
 * Skills loader — reads SKILL.md files from the repo's `skills/` directory
 * and exposes them to the agent runtime.
 *
 * Layout we expect:
 *   skills/
 *     <skill-name>/
 *       SKILL.md         # YAML frontmatter + markdown body
 *       scripts/...      # optional executable code
 *       *.md             # optional supporting docs
 *     <another-skill>/
 *       SKILL.md
 *
 * Each SKILL.md has a YAML frontmatter block with at least:
 *   name: <skill-name>
 *   description: <one-line summary the agent reads when deciding to load>
 *   license: <optional>
 *
 * The loader is cached in-process; restart the API to pick up new skills
 * after running `npm run skills:import`.
 */

import fs from "fs";
import path from "path";

export interface LoadedSkill {
  /** Directory key (matches `agents.skills[]` entries). */
  key: string;
  /** Display name from frontmatter, falls back to the key. */
  name: string;
  /** One-line description from frontmatter. */
  description: string;
  /** Optional license string from frontmatter. */
  license?: string;
  /** Absolute path to the skill directory. */
  directory: string;
  /** Raw SKILL.md content (frontmatter + body). */
  raw: string;
  /** Markdown body with the frontmatter stripped. */
  body: string;
}

const SKILLS_DIR_ENV = "AUTOFLOW_SKILLS_DIR";

function defaultSkillsDir(): string {
  // Walk up from this file to find the repo root and use `skills/`. We
  // can't rely on process.cwd() — workers run from `dist/` and the
  // dashboard sometimes spawns Node from a sibling directory.
  return path.resolve(__dirname, "..", "..", "..", "skills");
}

export function getSkillsDir(): string {
  return process.env[SKILLS_DIR_ENV] || defaultSkillsDir();
}

// allowlist: process-local skill cache — skills are immutable per release; reload on restart only
let cache: Map<string, LoadedSkill> | null = null;

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  // Tolerant YAML parser — skills use the `name:`, `description:`, and
  // optional `license:` keys. Description can span multiple lines via
  // `description: >` followed by indented lines. We unfold those.
  if (!raw.startsWith("---")) {
    return { meta: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: raw };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");

  const meta: Record<string, string> = {};
  const lines = fm.split("\n");
  let pendingKey: string | null = null;
  let pendingParts: string[] = [];

  const flushPending = (): void => {
    if (pendingKey) {
      meta[pendingKey] = pendingParts.join(" ").trim();
      pendingKey = null;
      pendingParts = [];
    }
  };

  for (const line of lines) {
    const match = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (match) {
      flushPending();
      const [, key, value] = match;
      const trimmed = (value ?? "").trim();
      if (trimmed === ">" || trimmed === "|") {
        pendingKey = key!;
      } else {
        meta[key!] = trimmed.replace(/^['"](.*)['"]$/, "$1");
      }
    } else if (pendingKey) {
      pendingParts.push(line.trim());
    }
  }
  flushPending();

  return { meta, body };
}

/**
 * Load every skill in the skills directory. Idempotent — first call walks
 * the filesystem, subsequent calls return the cached map.
 */
export function loadAllSkills(): Map<string, LoadedSkill> {
  if (cache) return cache;

  const map = new Map<string, LoadedSkill>();
  const dir = getSkillsDir();

  if (!fs.existsSync(dir)) {
    cache = map;
    return map;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(dir, entry.name);
    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;

    try {
      const raw = fs.readFileSync(skillFile, "utf8");
      const { meta, body } = parseFrontmatter(raw);
      map.set(entry.name, {
        key: entry.name,
        name: meta.name || entry.name,
        description: meta.description || "",
        license: meta.license,
        directory: skillDir,
        raw,
        body,
      });
    } catch (err) {
      console.warn(
        `[skills] failed to load ${entry.name}: ${(err as Error).message}`,
      );
    }
  }

  cache = map;
  return map;
}

/**
 * Look up a single skill by its directory key.
 */
export function getSkill(key: string): LoadedSkill | undefined {
  return loadAllSkills().get(key);
}

/**
 * Resolve a list of skill keys (from `agents.skills[]`) to their loaded
 * objects. Unknown keys are silently skipped so a renamed-or-removed
 * skill doesn't break the agent — they just see fewer skills available.
 */
export function resolveSkills(keys: string[]): LoadedSkill[] {
  const all = loadAllSkills();
  const out: LoadedSkill[] = [];
  for (const key of keys) {
    const skill = all.get(key);
    if (skill) out.push(skill);
  }
  return out;
}

/** Test helper. */
export function resetSkillsCacheForTests(): void {
  cache = null;
}
