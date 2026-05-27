/**
 * Skills security scanner — vets a candidate skill before it gets
 * committed to `skills/`. Runs three checks per skill, returns a verdict.
 *
 * Checks:
 *   1. Static pattern scan — regex hits in SKILL.md + scripts for known
 *      malicious patterns (reverse shells, credential exfiltration, curl
 *      pipe sh, destructive rm, etc.).
 *   2. Provenance — repo origin (anthropic-official, vetted org, unknown),
 *      git remote URL allowlist, basic age + size sanity.
 *   3. LLM grader (optional) — `gradeWithLlm: true` runs the skill's
 *      content through Claude with a security-review prompt. Slow, costs
 *      tokens, but catches obfuscated patterns the static scan misses.
 *
 * Verdicts:
 *   - "approved" — passes all enabled checks
 *   - "needs_review" — at least one check flagged something, manual review
 *   - "rejected" — at least one check found a clear malicious pattern
 *
 * Used by:
 *   - scripts/import-skills.ts during the bulk import pass
 *   - the per-skill admin UI (future) to re-scan on demand
 */

import fs from "fs";
import path from "path";

export type ScanVerdict = "approved" | "needs_review" | "rejected";

export type ScanSeverity = "info" | "warning" | "critical";

export interface ScanFinding {
  severity: ScanSeverity;
  /** Short machine-readable identifier. */
  code: string;
  /** Human-readable explanation of what was found. */
  message: string;
  /** File path relative to the skill directory, if applicable. */
  file?: string;
  /** Excerpt of the matched content, capped to keep findings readable. */
  excerpt?: string;
}

export interface ScanReport {
  skillKey: string;
  verdict: ScanVerdict;
  staticFindings: ScanFinding[];
  provenanceFindings: ScanFinding[];
  llmFindings: ScanFinding[];
  /** Whether each check ran (false when skipped via options). */
  staticRan: boolean;
  provenanceRan: boolean;
  llmRan: boolean;
  scannedAt: string;
}

export interface ScanOptions {
  /** Skip the static pattern scan. */
  skipStatic?: boolean;
  /** Skip the provenance check. */
  skipProvenance?: boolean;
  /** Run the LLM grader. Off by default — slow + paid. */
  gradeWithLlm?: boolean;
  /** Optional LLM grader function injected by the caller. */
  llmGrader?: (input: LlmGraderInput) => Promise<ScanFinding[]>;
  /** Provenance hints from the caller (origin repo, stars, etc.). */
  provenance?: ProvenanceInput;
}

export interface ProvenanceInput {
  /** Origin repo URL — e.g. https://github.com/anthropics/skills. */
  sourceRepo?: string;
  /** Star count from the host (GitHub API). */
  stars?: number;
  /** ISO timestamp of the last commit. */
  lastCommitAt?: string;
  /** Whether the source is on our manual allowlist of trusted orgs. */
  trustedOrigin?: boolean;
}

export interface LlmGraderInput {
  skillKey: string;
  skillBody: string;
  scriptContents: Array<{ path: string; content: string }>;
}

// ---------------------------------------------------------------------------
// Static patterns
// ---------------------------------------------------------------------------

interface StaticPattern {
  code: string;
  severity: ScanSeverity;
  pattern: RegExp;
  message: string;
}

const STATIC_PATTERNS: StaticPattern[] = [
  // ============ Critical — clear malice ============
  {
    code: "reverse_shell_bash",
    severity: "critical",
    pattern: /bash\s+-i\b.*\/dev\/tcp\//i,
    message: "Bash reverse-shell pattern (bash -i over /dev/tcp/).",
  },
  {
    code: "reverse_shell_nc",
    severity: "critical",
    pattern: /\bnc(?:at)?\b[^\n]*\s-e\b/,
    message: "netcat reverse-shell pattern (nc -e).",
  },
  {
    code: "rm_rf_root",
    severity: "critical",
    pattern: /\brm\s+-rf\s+(?:\/(?:\s|$|--no-preserve-root)|~|\$HOME|\$\{HOME\})/,
    message: "Recursive deletion of root, home, or $HOME — destructive.",
  },
  {
    code: "fork_bomb",
    severity: "critical",
    pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/,
    message: "Bash fork bomb signature.",
  },
  {
    code: "crypto_miner_xmrig",
    severity: "critical",
    pattern: /\bxmrig\b/i,
    message: "Reference to xmrig (Monero crypto miner).",
  },
  {
    code: "crypto_miner_pool",
    severity: "critical",
    pattern: /(?:stratum\+tcp|pool\.minexmr|nanopool\.org|f2pool\.com)/i,
    message: "Reference to a known cryptocurrency mining pool.",
  },
  // ============ Critical — credential exfiltration ============
  {
    code: "creds_aws",
    severity: "critical",
    pattern: /~?\/?\.aws\/(?:credentials|config)\b/,
    message: "Reads AWS credentials file.",
  },
  {
    code: "creds_ssh",
    severity: "critical",
    pattern: /~?\/?\.ssh\/(?:id_(?:rsa|ed25519|ecdsa)|authorized_keys)\b/,
    message: "Reads SSH private keys or authorized_keys.",
  },
  {
    code: "creds_netrc",
    severity: "critical",
    pattern: /~?\/?\.netrc\b/,
    message: "Reads ~/.netrc — typically holds plaintext credentials.",
  },
  {
    code: "etc_shadow",
    severity: "critical",
    pattern: /\/etc\/shadow\b/,
    message: "Reads /etc/shadow — Linux password hash store.",
  },
  // ============ Warnings — execution patterns worth a look ============
  {
    code: "curl_pipe_sh",
    severity: "warning",
    pattern:
      /\b(?:curl|wget|fetch)\b[^\n]*\|\s*(?:sh|bash|zsh|python|node|ruby|perl)\b/,
    message: "Pipes downloaded content directly into a shell/interpreter.",
  },
  {
    code: "eval_remote",
    severity: "warning",
    pattern:
      /\beval\b[^\n]*\$\(\s*(?:curl|wget)\b/,
    message: "Eval of remote-fetched content.",
  },
  {
    code: "base64_eval",
    severity: "warning",
    pattern:
      /\b(?:base64\s+(?:-d|--decode)|atob)\b[^\n]{0,80}(?:\|\s*(?:bash|sh)|eval)/,
    message: "Base64-decoded payload piped to a shell or eval.",
  },
  {
    code: "dotfile_write",
    severity: "warning",
    pattern:
      /(?:>>?|>>)\s*~?\/?\.(?:bashrc|zshrc|profile|bash_profile|zprofile|inputrc|config\/fish\/config\.fish)\b/,
    message: "Writes to user shell init files (persistence vector).",
  },
  {
    code: "crontab_install",
    severity: "warning",
    pattern: /\bcrontab\s+-/,
    message: "Modifies the user's crontab.",
  },
  {
    code: "sudo_invocation",
    severity: "info",
    pattern: /\bsudo\b/,
    message: "Uses sudo — review what privileged action it needs.",
  },
  {
    code: "env_credentials",
    severity: "warning",
    pattern:
      /\b(?:AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|STRIPE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)\b/,
    message: "References a sensitive environment variable. Confirm it's only read in a legitimate context.",
  },
  // ============ Info — install/network hints ============
  {
    code: "apt_install",
    severity: "info",
    pattern: /\bapt(?:-get)?\s+install\b/,
    message: "Installs system packages via apt.",
  },
  {
    code: "pip_install",
    severity: "info",
    pattern: /\bpip(?:3)?\s+install\b/,
    message: "Installs Python packages via pip.",
  },
  {
    code: "npm_install_global",
    severity: "info",
    pattern: /\bnpm\s+install\s+-g\b/,
    message: "Installs Node packages globally.",
  },
];

// ---------------------------------------------------------------------------
// Provenance allowlist
// ---------------------------------------------------------------------------

const TRUSTED_ORIGINS = [
  "github.com/anthropics/",
  "github.com/anthropic-experimental/",
  "github.com/vercel-labs/",
  "github.com/browserbase/",
];

function isTrustedOrigin(url?: string): boolean {
  if (!url) return false;
  return TRUSTED_ORIGINS.some((prefix) => url.includes(prefix));
}

// ---------------------------------------------------------------------------
// Static scan
// ---------------------------------------------------------------------------

function makeExcerpt(content: string, match: RegExpExecArray): string {
  const start = Math.max(0, match.index - 30);
  const end = Math.min(content.length, match.index + match[0].length + 30);
  const slice = content.slice(start, end).replace(/\s+/g, " ").trim();
  // JS `slice` cuts by UTF-16 code unit; trim off any lone surrogate left at
  // the end so JSON.stringify can't emit an orphan `\ud83d` that breaks
  // strict JSON parsers reading the manifest.
  const safe = trimLoneSurrogate(slice);
  return safe.length > 140 ? `${trimLoneSurrogate(safe.slice(0, 140))}…` : safe;
}

function trimLoneSurrogate(s: string): string {
  if (s.length === 0) return s;
  const last = s.charCodeAt(s.length - 1);
  // High surrogate without a paired low surrogate after it.
  if (last >= 0xd800 && last <= 0xdbff) return s.slice(0, -1);
  return s;
}

function staticScanContent(filename: string, content: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const pattern of STATIC_PATTERNS) {
    const re = new RegExp(pattern.pattern.source, pattern.pattern.flags.includes("g")
      ? pattern.pattern.flags
      : pattern.pattern.flags + "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      findings.push({
        severity: pattern.severity,
        code: pattern.code,
        message: pattern.message,
        file: filename,
        excerpt: makeExcerpt(content, match),
      });
      // Cap to avoid one noisy file producing 100 findings of the same code.
      if (findings.filter((f) => f.code === pattern.code).length >= 5) break;
    }
  }
  return findings;
}

function listScannableFiles(skillDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(full);
      } else {
        out.push(full);
      }
    }
  };
  walk(skillDir);
  return out;
}

export function staticScan(skillDir: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const file of listScannableFiles(skillDir)) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(skillDir, file);
    findings.push(...staticScanContent(rel, content));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Provenance check
// ---------------------------------------------------------------------------

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

export function provenanceCheck(input?: ProvenanceInput): ScanFinding[] {
  const findings: ScanFinding[] = [];
  if (!input) {
    findings.push({
      severity: "info",
      code: "no_provenance_data",
      message: "No provenance data supplied — origin repo / stars / last-commit unknown.",
    });
    return findings;
  }

  if (input.trustedOrigin === true || isTrustedOrigin(input.sourceRepo)) {
    findings.push({
      severity: "info",
      code: "trusted_origin",
      message: "Origin is on the trusted-org allowlist.",
    });
  } else if (input.sourceRepo) {
    findings.push({
      severity: "warning",
      code: "untrusted_origin",
      message: `Origin ${input.sourceRepo} is not on the trusted-org allowlist; review the maintainer.`,
    });
  }

  if (typeof input.stars === "number" && input.stars < 10) {
    findings.push({
      severity: "warning",
      code: "low_star_count",
      message: `Source repo has only ${input.stars} stars — limited public scrutiny.`,
    });
  }

  if (input.lastCommitAt) {
    const ts = Date.parse(input.lastCommitAt);
    if (Number.isFinite(ts)) {
      const age = Date.now() - ts;
      if (age > FIVE_YEARS_MS) {
        findings.push({
          severity: "warning",
          code: "stale_repo",
          message: "Source repo hasn't been updated in over five years — unmaintained.",
        });
      } else if (age < NINETY_DAYS_MS && input.stars !== undefined && input.stars < 5) {
        findings.push({
          severity: "info",
          code: "young_low_star_repo",
          message: "Source repo is recent (<90 days) and low-star. Treat as unvetted.",
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// LLM grader (interface only — caller supplies the actual model call)
// ---------------------------------------------------------------------------

export async function llmGraderCheck(
  skillDir: string,
  input: { skillKey: string; skillBody: string },
  grader: (input: LlmGraderInput) => Promise<ScanFinding[]>,
): Promise<ScanFinding[]> {
  const scripts: Array<{ path: string; content: string }> = [];
  for (const file of listScannableFiles(skillDir)) {
    const rel = path.relative(skillDir, file);
    if (!/\.(?:sh|bash|py|js|ts|rb|pl)$/i.test(rel)) continue;
    try {
      const content = fs.readFileSync(file, "utf8");
      // Cap each script at 16KB to keep grader prompts bounded.
      scripts.push({ path: rel, content: content.slice(0, 16_384) });
    } catch {
      // ignore unreadable
    }
  }
  return grader({
    skillKey: input.skillKey,
    skillBody: input.skillBody.slice(0, 32_768),
    scriptContents: scripts,
  });
}

// ---------------------------------------------------------------------------
// Verdict resolution
// ---------------------------------------------------------------------------

function resolveVerdict(
  staticFindings: ScanFinding[],
  provenanceFindings: ScanFinding[],
  llmFindings: ScanFinding[],
): ScanVerdict {
  const all = [...staticFindings, ...provenanceFindings, ...llmFindings];
  if (all.some((f) => f.severity === "critical")) return "rejected";
  if (all.some((f) => f.severity === "warning")) return "needs_review";
  return "approved";
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function scanSkill(
  skillKey: string,
  skillDir: string,
  skillBody: string,
  options: ScanOptions = {},
): Promise<ScanReport> {
  const staticFindings = options.skipStatic ? [] : staticScan(skillDir);
  const provenanceFindings = options.skipProvenance
    ? []
    : provenanceCheck(options.provenance);

  let llmFindings: ScanFinding[] = [];
  if (options.gradeWithLlm && options.llmGrader) {
    try {
      llmFindings = await llmGraderCheck(
        skillDir,
        { skillKey, skillBody },
        options.llmGrader,
      );
    } catch (err) {
      llmFindings = [
        {
          severity: "info",
          code: "llm_grader_error",
          message: `LLM grader failed: ${(err as Error).message}`,
        },
      ];
    }
  }

  return {
    skillKey,
    verdict: resolveVerdict(staticFindings, provenanceFindings, llmFindings),
    staticFindings,
    provenanceFindings,
    llmFindings,
    staticRan: !options.skipStatic,
    provenanceRan: !options.skipProvenance,
    llmRan: Boolean(options.gradeWithLlm && options.llmGrader),
    scannedAt: new Date().toISOString(),
  };
}
