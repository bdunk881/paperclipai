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
// ---------------------------------------------------------------------------

const BOOTSTRAP_REFS: string[] = [
  "anthropics/skills@pdf",
  "anthropics/skills@docx",
  "anthropics/skills@xlsx",
  "anthropics/skills@pptx",
  "anthropics/skills@artifacts-builder",
  "anthropics/skills@brand-guidelines",
  "anthropics/skills@canva",
  "anthropics/skills@mcp-builder",
  "anthropics/skills@skill-creator",
  "anthropics/skills@webdev",
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

function fetchRepoProvenance(
  owner: string,
  _repo: string,
): { trustedOrigin: boolean } {
  // Cheap version: trust on org allowlist. GitHub-API enrichment (stars,
  // last-commit) lands as a follow-up — skipping it keeps the import
  // self-contained and offline-runnable.
  const trustedOrgs = [
    "anthropics",
    "anthropic-experimental",
    "vercel-labs",
    "browserbase",
  ];
  return { trustedOrigin: trustedOrgs.includes(owner) };
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

    const provenance = fetchRepoProvenance(owner, repo);

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
          sourceRepo: `github.com/${owner}/${repo}`,
          trustedOrigin: provenance.trustedOrigin,
        },
        gradeWithLlm: Boolean(options.grader),
        llmGrader: options.grader,
      });

      console.log(`  • ${skillKey} — ${summarize(report)}`);
      for (const f of [...report.staticFindings, ...report.provenanceFindings, ...report.llmFindings]) {
        if (f.severity === "info") continue;
        console.log(`      [${f.severity}] ${f.code}: ${f.message}${f.file ? ` (${f.file})` : ""}`);
      }

      options.manifest.entries[skillKey] = {
        ref,
        skillKey,
        verdict: report.verdict,
        scannedAt: report.scannedAt,
        findings: [...report.staticFindings, ...report.provenanceFindings, ...report.llmFindings],
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

  console.log(`Importing ${refs.length} ref(s); llm=${useLlm} force=${force}`);
  console.log("");

  for (const ref of refs) {
    await processRef(ref, { grader, force, manifest });
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
