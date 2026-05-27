/* eslint-disable no-console */
/**
 * Skills import + scan pipeline.
 *
 * Iterates a list of skill source repos (skills.sh-style git refs of the
 * form `owner/repo@skill-name` or `owner/repo` to import every skill in
 * the repo), runs the security scanner against each, and writes approved
 * skills to the repo's `skills/` directory.
 *
 * Usage:
 *   # Import a curated bootstrap set with static + provenance checks
 *   npx ts-node scripts/import-skills.ts
 *
 *   # Run LLM-graded review too (requires ANTHROPIC_API_KEY)
 *   IMPORT_SKILLS_LLM=1 npx ts-node scripts/import-skills.ts
 *
 *   # Import a custom list of skills
 *   npx ts-node scripts/import-skills.ts anthropics/skills@pdf vercel-labs/skills@web-search
 *
 *   # Force re-import (overwrites existing skill directories)
 *   IMPORT_SKILLS_FORCE=1 npx ts-node scripts/import-skills.ts
 *
 * For the full skills.sh registry pass `IMPORT_SKILLS_FULL=1` and a path
 * to a newline-delimited list of refs as the first argument:
 *
 *   IMPORT_SKILLS_FULL=1 npx ts-node scripts/import-skills.ts ./skills-list.txt
 *
 * Writes a manifest of every scan attempt to `skills/.manifest.json` so
 * the next run can skip already-approved skills and report changed verdicts.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { scanSkill, type ScanReport, type ScanFinding } from "../src/skills/scanner";
import { createAnthropicLlmGrader } from "../src/skills/llmGrader";
import { fetchGithubProvenance } from "../src/skills/githubProvenance";

const SKILLS_DIR = path.resolve(__dirname, "..", "skills");
const MANIFEST_PATH = path.join(SKILLS_DIR, ".manifest.json");

interface ManifestEntry {
  ref: string;
  skillKey: string;
  verdict: ScanReport["verdict"];
  scannedAt: string;
  findings: ScanFinding[];
}

interface Manifest {
  generatedAt: string;
  entries: Record<string, ManifestEntry>;
}

// ---------------------------------------------------------------------------
// Bootstrap set — small, vetted, known-clean skills for the first scan pass.
// Extend by editing this list or passing refs on the CLI. For the full
// 34K+ skills.sh registry pass IMPORT_SKILLS_FULL + a list file.
//
// Curation criteria (Brad): only include refs whose subject matter actually
// shows up in AutoFlow workflows. Drop drive-by additions ("canva", etc.)
// that aren't on the v1 customer loop. Each entry below has a one-line
// rationale tying it back to a code path in this repo.
//
// Hand-authored AutoFlow skills (NOT imported here; live in skills/ already):
//   - autoflow-backend            (TS Express, RLS workspace context, middleware)
//   - autoflow-frontend           (Vite + React dashboard, af2 design tokens)
//   - autoflow-llm-stack          (tier router, provider adapters, agent runtime)
//   - autoflow-supabase-rls       (workspace_id RLS pattern, JWT verification)
//   - autoflow-billing            (Stripe, entitlements, plan tiers, 402 payload)
//   - autoflow-queue-workers      (BullMQ, Redis, src/worker.ts, scheduler)
//   - autoflow-testing            (Jest, in-memory fallback, supertest patterns)
//   - autoflow-product-model      (canonical glossary, product loop, forbidden words)
//   - native-auth-ciam            (Microsoft Entra External ID reference)
// ---------------------------------------------------------------------------

const BOOTSTRAP_REFS: string[] = [
  // — Document processing — useful for connectors that ingest customer files
  //   (Gmail attachments, HubSpot docs, Linear file uploads, etc.) and for
  //   producing customer deliverables (reports, invoices).
  "anthropics/skills@pdf",
  "anthropics/skills@docx",
  "anthropics/skills@xlsx",
  "anthropics/skills@pptx",

  // — Platform-internal skills —
  //   webdev: react/vite/tailwind patterns, used by the dashboard +
  //     landing teams (dashboard/ + landing/).
  //   mcp-builder: AutoFlow exposes + consumes MCP servers (src/mcp/,
  //     src/agents/runtime/mcpClient.ts). Build new MCP integrations
  //     against this skill's conventions.
  //   skill-creator: this repo has its own skills system (src/skills/);
  //     use this when authoring or scaffolding new ones.
  //   brand-guidelines + artifacts-builder: support the v2 editorial
  //     brand direction (autoflow-brand/, docs/design/v2/) when an agent
  //     is asked to produce on-brand assets or rich artifacts.
  "anthropics/skills@webdev",
  "anthropics/skills@mcp-builder",
  "anthropics/skills@skill-creator",
  "anthropics/skills@brand-guidelines",
  "anthropics/skills@artifacts-builder",

  // — Dropped from the original bootstrap —
  //   anthropics/skills@canva — AutoFlow doesn't integrate with Canva and
  //     has its own brand asset pipeline (autoflow-brand/, infra/brand-assets/).
  //     Re-add only if a Canva connector lands.
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readManifest(): Manifest {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { generatedAt: new Date().toISOString(), entries: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
  } catch {
    return { generatedAt: new Date().toISOString(), entries: {} };
  }
}

function writeManifest(manifest: Manifest): void {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
}

// A trusted-origin manifest entry should not be silently replaced by a
// scan from an untrusted re-vendor of the same skillKey. The skills.sh
// catalog contains umbrella repos (e.g. sickn33/antigravity-awesome-skills)
// that re-vendor entries from anthropics/skills under the same skillKey;
// without this guard, those rescans overwrite the canonical entry with
// `untrusted_origin` findings.
function isTrustRegression(
  previous: ManifestEntry | undefined,
  candidateFindings: ScanFinding[],
): boolean {
  if (!previous) return false;
  const prevTrusted = previous.findings.some((f) => f.code === "trusted_origin");
  const candidateUntrusted = candidateFindings.some((f) => f.code === "untrusted_origin");
  return prevTrusted && candidateUntrusted;
}

// Strict allowlists for ref components. GitHub permits alphanumerics + `_`,
// `-`, and `.` in usernames + repo names — match that and bound length so
// the value going into `git clone https://github.com/<owner>/<repo>.git`
// can't carry anything CodeQL's command-injection sink-tracking would
// flag. Skill keys are directory names — same character set + no `..`.
const SAFE_REF_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SAFE_SKILL_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function parseRef(ref: string): { owner: string; repo: string; skill?: string } {
  const at = ref.indexOf("@");
  const head = at === -1 ? ref : ref.slice(0, at);
  const skill = at === -1 ? undefined : ref.slice(at + 1);
  const [owner, repo] = head.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid ref "${ref}" — expected owner/repo[@skill].`);
  }
  if (!SAFE_REF_COMPONENT.test(owner)) {
    throw new Error(`Invalid owner "${owner}" — allowlisted to [A-Za-z0-9._-].`);
  }
  if (!SAFE_REF_COMPONENT.test(repo)) {
    throw new Error(`Invalid repo "${repo}" — allowlisted to [A-Za-z0-9._-].`);
  }
  if (skill !== undefined && !SAFE_SKILL_KEY.test(skill)) {
    throw new Error(`Invalid skill "${skill}" — allowlisted to [A-Za-z0-9._-].`);
  }
  return { owner, repo, skill };
}

function cloneTo(tempDir: string, owner: string, repo: string): void {
  // owner/repo are allowlist-checked above; pass as arguments (not via
  // a shell) so quoting / escaping cannot affect the spawned process.
  execFileSync(
    "git",
    ["clone", "--depth=1", "--quiet", `https://github.com/${owner}/${repo}.git`, tempDir],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
}

/**
 * Defence-in-depth path containment check. Returns true when `child` is
 * `parent` or a descendant of it. Used so `path.join(SKILLS_DIR, key)`
 * can never escape the repo's `skills/` directory even if the key
 * validator drifts.
 */
function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

interface DiscoveredSkill {
  /** Skill key (directory basename). */
  name: string;
  /** Absolute filesystem path to the skill's directory. */
  dir: string;
}

function discoverSkills(repoDir: string): DiscoveredSkill[] {
  // A repo can publish multiple skills. Known layouts:
  //   1. Root SKILL.md           — repo IS the skill (rare)
  //   2. <repo>/<skill>/SKILL.md — flat layout (vercel-labs/skills, ...)
  //   3. <repo>/skills/<skill>/SKILL.md — nested layout (anthropics/skills)
  const out: DiscoveredSkill[] = [];

  if (fs.existsSync(path.join(repoDir, "SKILL.md"))) {
    out.push({ name: path.basename(repoDir), dir: repoDir });
  }

  const candidateRoots = [repoDir, path.join(repoDir, "skills")];
  for (const root of candidateRoots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "spec") {
        continue;
      }
      const candidate = path.join(root, entry.name);
      if (fs.existsSync(path.join(candidate, "SKILL.md"))) {
        out.push({ name: entry.name, dir: candidate });
      }
    }
  }

  // Dedupe by `dir` — a repo with both root and nested skill dirs only
  // surfaces each unique path once.
  const seen = new Set<string>();
  return out.filter((s) => {
    if (seen.has(s.dir)) return false;
    seen.add(s.dir);
    return true;
  });
}

function readSkillBody(skillDir: string): string {
  return fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
}

async function fetchRepoProvenance(
  owner: string,
  repo: string,
): Promise<
  Awaited<ReturnType<typeof fetchGithubProvenance>>
> {
  // Enriched provenance: hits the GitHub REST API for stars, last
  // commit, license, and archived state. Falls back to the org-
  // allowlist-only behavior when the API call fails (no network, rate
  // limit, etc.) so the import script remains self-contained.
  //
  // Set GITHUB_TOKEN in the environment to lift the 60/hour anonymous
  // rate limit — required for the full skills.sh registry sweep.
  return fetchGithubProvenance(owner, repo);
}

function copySkill(srcDir: string, destDir: string): void {
  // destDir is derived from a SKILL key. Defence-in-depth: it MUST land
  // under SKILLS_DIR so a future regression on the key validator can't
  // chmod / rm somewhere unexpected.
  const resolved = path.resolve(destDir);
  if (!isWithin(SKILLS_DIR, resolved)) {
    throw new Error(`Refusing to copy skill outside skills/: ${destDir}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
  // Use Node's recursive copy (Node 16.7+) instead of spawning cp(1) —
  // keeps the tree-walk in-process and avoids a child-process exec on
  // attacker-influenced filenames inside srcDir.
  fs.cpSync(srcDir, resolved, { recursive: true });
  // Strip .git if it leaked in.
  fs.rmSync(path.join(resolved, ".git"), { recursive: true, force: true });
}

function summarize(report: ScanReport): string {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const f of [...report.staticFindings, ...report.provenanceFindings, ...report.llmFindings]) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  return `verdict=${report.verdict} critical=${counts.critical} warning=${counts.warning} info=${counts.info}`;
}

// ---------------------------------------------------------------------------
// Per-ref processing
// ---------------------------------------------------------------------------

/**
 * Clone a repo once and scan every requested skill in it. Used by the
 * top-level loop after refs are grouped by `owner/repo` so a 750-ref
 * scan with 108 unique repos clones 108 times instead of 750.
 */
async function processRepoBatch(
  repoKey: string,
  refs: string[],
  options: {
    grader?: ReturnType<typeof createAnthropicLlmGrader>;
    force: boolean;
    manifest: Manifest;
  },
): Promise<void> {
  const [owner, repo] = repoKey.split("/") as [string, string];
  // Pre-check: if every ref in this batch is already-approved + force is
  // off, skip the clone entirely.
  const wantedSkills = new Set(
    refs
      .map((ref) => {
        try {
          return parseRef(ref).skill;
        } catch {
          return undefined;
        }
      })
      .filter((s): s is string => Boolean(s)),
  );
  if (!options.force && wantedSkills.size > 0) {
    const allApproved = [...wantedSkills].every(
      (key) => options.manifest.entries[key]?.verdict === "approved",
    );
    if (allApproved) {
      console.log(
        `▶ ${repoKey} (${refs.length} ref(s)) — all already approved, skipping clone`,
      );
      return;
    }
  }

  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "autoflow-skills-"));
  const repoDir = path.join(tempBase, "repo");

  try {
    console.log(`▶ ${repoKey} (${refs.length} ref(s)) — cloning…`);
    cloneTo(repoDir, owner, repo);

    const discovered = discoverSkills(repoDir);
    const provenance = await fetchRepoProvenance(owner, repo);
    if (provenance.fetchError) {
      console.log(`    (github-api fetch failed: ${provenance.fetchError})`);
    } else {
      const fields = [
        typeof provenance.stars === "number" ? `${provenance.stars}★` : null,
        provenance.lastCommitAt ? `last-commit ${provenance.lastCommitAt.slice(0, 10)}` : null,
        provenance.license ? `license ${provenance.license}` : null,
        provenance.archived ? "archived" : null,
      ].filter(Boolean);
      if (fields.length > 0) console.log(`    (github: ${fields.join(", ")})`);
    }

    for (const ref of refs) {
      const { skill: skillFilter } = parseRef(ref);
      const targets = skillFilter
        ? discovered.filter((d) => d.name === skillFilter)
        : discovered;

      if (targets.length === 0) {
        console.log(`  • ${ref} — no match in repo (had ${discovered.length})`);
        continue;
      }

      for (const { name: skillName, dir: srcDir } of targets) {
        const skillKey = skillName;
        if (!SAFE_SKILL_KEY.test(skillKey)) {
          console.log(`  • ${skillKey} — rejected (unsafe skill key)`);
          continue;
        }
        const destDir = path.join(SKILLS_DIR, skillKey);

        const previous = options.manifest.entries[skillKey];
        if (previous && previous.verdict === "approved" && !options.force) {
          console.log(`  • ${skillKey} — already approved (skip)`);
          continue;
        }

        const skillBody = readSkillBody(srcDir);
        const report = await scanSkill(skillKey, srcDir, skillBody, {
          provenance: {
            sourceRepo: provenance.sourceRepo,
            trustedOrigin: provenance.trustedOrigin,
            stars: provenance.stars,
            lastCommitAt: provenance.lastCommitAt,
          },
          gradeWithLlm: Boolean(options.grader),
          llmGrader: options.grader,
        });

        console.log(`  • ${skillKey} — ${summarize(report)}`);
        const allFindings = [...report.staticFindings, ...report.provenanceFindings, ...report.llmFindings];
        for (const f of allFindings) {
          if (f.severity === "info") continue;
          console.log(`      [${f.severity}] ${f.code}: ${f.message}${f.file ? ` (${f.file})` : ""}`);
        }

        if (isTrustRegression(previous, allFindings)) {
          console.log(`      → kept previous entry (trusted source ${previous!.ref} preferred over ${ref})`);
          continue;
        }

        options.manifest.entries[skillKey] = {
          ref,
          skillKey,
          verdict: report.verdict,
          scannedAt: report.scannedAt,
          findings: allFindings,
        };

        if (report.verdict === "approved") {
          copySkill(srcDir, destDir);
          console.log(`      → installed to skills/${skillKey}`);
        } else {
          console.log(`      → not installed (${report.verdict})`);
        }
      }
    }
  } catch (err) {
    console.error(`✖ ${repoKey} — ${(err as Error).message}`);
    for (const ref of refs) {
      options.manifest.entries[ref] = {
        ref,
        skillKey: ref,
        verdict: "needs_review",
        scannedAt: new Date().toISOString(),
        findings: [
          { severity: "info", code: "import_error", message: (err as Error).message },
        ],
      };
    }
  } finally {
    fs.rmSync(tempBase, { recursive: true, force: true });
  }
}

async function processRef(
  ref: string,
  options: {
    grader?: ReturnType<typeof createAnthropicLlmGrader>;
    force: boolean;
    manifest: Manifest;
  },
): Promise<void> {
  const { owner, repo, skill: skillFilter } = parseRef(ref);
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "autoflow-skills-"));
  const repoDir = path.join(tempBase, "repo");

  try {
    console.log(`▶ ${ref} — cloning…`);
    cloneTo(repoDir, owner, repo);

    const discovered = discoverSkills(repoDir);
    const targets = skillFilter
      ? discovered.filter((d) => d.name === skillFilter)
      : discovered;

    if (targets.length === 0) {
      console.log(
        `  no skills matched (looked for ${skillFilter ?? "any"}; repo had ${discovered.length})`,
      );
      return;
    }

    const provenance = await fetchRepoProvenance(owner, repo);
    if (provenance.fetchError) {
      console.log(`    (github-api fetch failed: ${provenance.fetchError})`);
    } else {
      const fields = [
        typeof provenance.stars === "number" ? `${provenance.stars}★` : null,
        provenance.lastCommitAt ? `last-commit ${provenance.lastCommitAt.slice(0, 10)}` : null,
        provenance.license ? `license ${provenance.license}` : null,
        provenance.archived ? "archived" : null,
      ].filter(Boolean);
      if (fields.length > 0) console.log(`    (github: ${fields.join(", ")})`);
    }

    for (const { name: skillName, dir: srcDir } of targets) {
      const skillKey = skillName;
      // Belt-and-suspenders: re-validate the skill key before letting
      // it shape any filesystem path. discoverSkills returns names from
      // readdirSync, but the static guard here is what CodeQL's path-
      // traversal taint tracker expects.
      if (!SAFE_SKILL_KEY.test(skillKey)) {
        console.log(`  • ${skillKey} — rejected (unsafe skill key)`);
        continue;
      }
      const destDir = path.join(SKILLS_DIR, skillKey);

      const previous = options.manifest.entries[skillKey];
      if (previous && previous.verdict === "approved" && !options.force) {
        console.log(`  • ${skillKey} — already approved (skip; pass IMPORT_SKILLS_FORCE=1 to re-scan)`);
        continue;
      }

      const skillBody = readSkillBody(srcDir);
      const report = await scanSkill(skillKey, srcDir, skillBody, {
        provenance: {
          sourceRepo: provenance.sourceRepo,
          trustedOrigin: provenance.trustedOrigin,
          stars: provenance.stars,
          lastCommitAt: provenance.lastCommitAt,
        },
        gradeWithLlm: Boolean(options.grader),
        llmGrader: options.grader,
      });

      console.log(`  • ${skillKey} — ${summarize(report)}`);
      const allFindings = [...report.staticFindings, ...report.provenanceFindings, ...report.llmFindings];
      for (const f of allFindings) {
        if (f.severity === "info") continue;
        console.log(`      [${f.severity}] ${f.code}: ${f.message}${f.file ? ` (${f.file})` : ""}`);
      }

      if (isTrustRegression(previous, allFindings)) {
        console.log(`      → kept previous entry (trusted source ${previous!.ref} preferred over ${ref})`);
        continue;
      }

      options.manifest.entries[skillKey] = {
        ref,
        skillKey,
        verdict: report.verdict,
        scannedAt: report.scannedAt,
        findings: allFindings,
      };

      if (report.verdict === "approved") {
        copySkill(srcDir, destDir);
        console.log(`      → installed to skills/${skillKey}`);
      } else {
        console.log(`      → not installed (${report.verdict})`);
      }
    }
  } catch (err) {
    console.error(`✖ ${ref} — ${(err as Error).message}`);
    options.manifest.entries[ref] = {
      ref,
      skillKey: ref,
      verdict: "needs_review",
      scannedAt: new Date().toISOString(),
      findings: [
        {
          severity: "info",
          code: "import_error",
          message: (err as Error).message,
        },
      ],
    };
  } finally {
    fs.rmSync(tempBase, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const force = process.env.IMPORT_SKILLS_FORCE === "1";
  const useLlm = process.env.IMPORT_SKILLS_LLM === "1";
  const full = process.env.IMPORT_SKILLS_FULL === "1";

  let refs: string[];
  if (full && argv[0]) {
    refs = fs
      .readFileSync(argv[0], "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (argv.length > 0) {
    refs = argv;
  } else {
    refs = BOOTSTRAP_REFS;
  }

  const grader = useLlm ? createAnthropicLlmGrader() : undefined;
  const manifest = readManifest();

  // Dedupe by source repo. The full-registry scan typically points many
  // refs at the same repo (e.g. 193 refs across `sickn33/antigravity-
  // awesome-skills`); cloning once per ref instead of once per repo
  // wastes ~80% of wall clock on git fetches. Group by `owner/repo`,
  // clone once, then process every requested skill from that clone.
  const byRepo = new Map<string, string[]>();
  for (const ref of refs) {
    try {
      const { owner, repo } = parseRef(ref);
      const key = `${owner}/${repo}`;
      const list = byRepo.get(key) ?? [];
      list.push(ref);
      byRepo.set(key, list);
    } catch (err) {
      console.error(`✖ ${ref} — ${(err as Error).message}`);
      manifest.entries[ref] = {
        ref,
        skillKey: ref,
        verdict: "needs_review",
        scannedAt: new Date().toISOString(),
        findings: [
          { severity: "info", code: "import_error", message: (err as Error).message },
        ],
      };
    }
  }

  console.log(
    `Importing ${refs.length} ref(s) across ${byRepo.size} unique repo(s); llm=${useLlm} force=${force}`,
  );
  console.log("");

  for (const [repoKey, repoRefs] of byRepo) {
    await processRepoBatch(repoKey, repoRefs, { grader, force, manifest });
    writeManifest(manifest);
  }

  console.log("");
  console.log(`Manifest written to ${path.relative(process.cwd(), MANIFEST_PATH)}`);
  const counts = { approved: 0, needs_review: 0, rejected: 0 };
  for (const entry of Object.values(manifest.entries)) {
    counts[entry.verdict]++;
  }
  console.log(`Summary: approved=${counts.approved} needs_review=${counts.needs_review} rejected=${counts.rejected}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
