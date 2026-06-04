import { z } from "zod";
import { extractStructuredOutput } from "../engine/structuredOutput";

export const TEAM_ASSEMBLY_SCHEMA_VERSION = "2026-04-27";

export const modelTierSchema = z.enum(["lite", "standard", "power"]);

export const normalizedGoalDocumentSchema = z.object({
  sourceType: z.enum(["free_text", "notion", "google-doc", "markdown"]),
  goal: z.string().trim().min(1),
  targetCustomer: z.string().trim().nullable(),
  successMetrics: z.array(z.string().trim().min(1)),
  constraints: z.array(z.string().trim().min(1)),
  budget: z.string().trim().nullable(),
  timeHorizon: z.string().trim().nullable(),
  importedContextSummary: z.string().trim().nullable().optional(),
  planReadinessThreshold: z.number().min(0).max(1),
});

export const prdSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  targetCustomer: z.string().trim().min(1),
  problemStatement: z.string().trim().min(1),
  proposedSolution: z.string().trim().min(1),
  successMetrics: z.array(z.string().trim().min(1)).min(1),
  constraints: z.array(z.string().trim().min(1)).min(1),
  budget: z.string().trim().min(1),
  timeHorizon: z.string().trim().min(1),
  assumptions: z.array(z.string().trim().min(1)).default([]),
  risks: z.array(z.string().trim().min(1)).default([]),
  openQuestions: z.array(z.string().trim().min(1)).default([]),
});

const roleLibraryEntrySchema = z.object({
  roleKey: z.string().trim().min(1),
  title: z.string().trim().min(1),
  roleType: z.enum(["executive", "operator"]),
  department: z.string().trim().min(1),
  mandate: z.string().trim().min(1),
  defaultReportsToRoleKey: z.string().trim().min(1).nullable().optional(),
  defaultSkills: z.array(z.string().trim().min(1)).default([]),
  defaultTools: z.array(z.string().trim().min(1)).default([]),
  defaultModelTier: modelTierSchema,
  hiringSignals: z.array(z.string().trim().min(1)).default([]),
});

const staffingRecommendationSchema = z.object({
  roleKey: z.string().trim().min(1),
  title: z.string().trim().min(1),
  roleType: z.enum(["executive", "operator"]),
  department: z.string().trim().min(1),
  headcount: z.number().int().positive(),
  reportsToRoleKey: z.string().trim().min(1).nullable(),
  mandate: z.string().trim().min(1),
  justification: z.string().trim().min(1),
  kpis: z.array(z.string().trim().min(1)).min(1),
  skills: z.array(z.string().trim().min(1)).min(1),
  tools: z.array(z.string().trim().min(1)).min(1),
  modelTier: modelTierSchema,
  budgetMonthlyUsd: z.number().min(0).nullable(),
  provisioningInstructions: z.string().trim().min(1),
});

export const phasePlanSchema = z.object({
  objectives: z.array(z.string().trim().min(1)).min(1),
  deliverables: z.array(z.string().trim().min(1)).min(1),
  ownerRoleKeys: z.array(z.string().trim().min(1)).min(1),
});

const teamAssemblyResultObjectSchema = z.object({
  schemaVersion: z.literal(TEAM_ASSEMBLY_SCHEMA_VERSION),
  company: z.object({
    name: z.string().trim().min(1).nullable(),
    goal: z.string().trim().min(1),
    targetCustomer: z.string().trim().min(1).nullable(),
    budget: z.string().trim().min(1).nullable(),
    timeHorizon: z.string().trim().min(1).nullable(),
  }),
  summary: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  orgChart: z.object({
    executives: z.array(staffingRecommendationSchema),
    operators: z.array(staffingRecommendationSchema),
    reportingLines: z.array(
      z.object({
        managerRoleKey: z.string().trim().min(1),
        reportRoleKey: z.string().trim().min(1),
      })
    ),
  }),
  provisioningPlan: z.object({
    teamName: z.string().trim().min(1),
    deploymentMode: z.literal("continuous_agents"),
    agents: z.array(staffingRecommendationSchema).min(1),
  }),
  roadmap306090: z.object({
    day30: phasePlanSchema,
    day60: phasePlanSchema,
    day90: phasePlanSchema,
  }),
});

/**
 * HEL-455: light, deterministic normalization applied BEFORE zod validation.
 * gemini-2.5-pro reliably under-specifies org-chart entries — it omits
 * `roleType` / `headcount` even though the (now-explicit) prompt asks for them.
 * Fill ONLY the unambiguous gaps so a good plan validates instead of 422-ing:
 *   - a role's `roleType` is implied by which array it sits in (executives →
 *     "executive", operators → "operator"); an agent inherits it from the
 *     matching `roleKey`;
 *   - a staffed role is at least 1 head.
 * Everything else (department, mandate, …) still relies on the model following
 * the prompt — we never invent semantic content.
 */
function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    : [];
}

function defaultHeadcount(item: Record<string, unknown>): void {
  const h = item.headcount;
  if (typeof h !== "number" || !Number.isFinite(h) || h < 1) {
    item.headcount = 1;
  }
}

function normalizeTeamAssemblyRaw(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const obj = input as Record<string, unknown>;
  const roleTypeByKey = new Map<string, "executive" | "operator">();

  const org = obj.orgChart;
  if (org && typeof org === "object") {
    const orgObj = org as Record<string, unknown>;
    for (const item of asRecordArray(orgObj.executives)) {
      item.roleType = "executive";
      defaultHeadcount(item);
      if (typeof item.roleKey === "string") roleTypeByKey.set(item.roleKey, "executive");
    }
    for (const item of asRecordArray(orgObj.operators)) {
      item.roleType = "operator";
      defaultHeadcount(item);
      if (typeof item.roleKey === "string") roleTypeByKey.set(item.roleKey, "operator");
    }
  }

  const plan = obj.provisioningPlan;
  if (plan && typeof plan === "object") {
    for (const agent of asRecordArray((plan as Record<string, unknown>).agents)) {
      defaultHeadcount(agent);
      if (agent.roleType !== "executive" && agent.roleType !== "operator") {
        const inferred =
          typeof agent.roleKey === "string" ? roleTypeByKey.get(agent.roleKey) : undefined;
        if (inferred) agent.roleType = inferred;
      }
    }
  }

  return obj;
}

export const teamAssemblyResultSchema = z.preprocess(
  normalizeTeamAssemblyRaw,
  teamAssemblyResultObjectSchema,
);

export const DEFAULT_ROLE_LIBRARY = [
  {
    roleKey: "ceo",
    title: "CEO",
    roleType: "executive",
    department: "executive",
    mandate: "Own strategy, resource allocation, and cross-functional prioritization.",
    defaultReportsToRoleKey: null,
    defaultSkills: ["paperclip"],
    defaultTools: ["notion", "slack", "github"],
    defaultModelTier: "power",
    hiringSignals: ["ambiguous business strategy", "multi-function coordination", "budget tradeoffs"],
  },
  {
    roleKey: "cto",
    title: "CTO",
    roleType: "executive",
    department: "engineering",
    mandate: "Own product architecture, engineering throughput, and technical risk management.",
    defaultReportsToRoleKey: "ceo",
    defaultSkills: ["paperclip", "cto-routines"],
    defaultTools: ["github", "vercel"],
    defaultModelTier: "power",
    hiringSignals: ["software product delivery", "integration complexity", "technical roadmap"],
  },
  {
    roleKey: "cmo",
    title: "CMO",
    roleType: "executive",
    department: "marketing",
    mandate: "Own positioning, demand generation, and content strategy.",
    defaultReportsToRoleKey: "ceo",
    defaultSkills: ["paperclip", "cmo-routines"],
    defaultTools: ["notion", "slack"],
    defaultModelTier: "power",
    hiringSignals: ["audience acquisition", "content moat", "brand building"],
  },
  {
    roleKey: "cro",
    title: "CRO",
    roleType: "executive",
    department: "sales",
    mandate: "Own pipeline creation, conversion, and revenue expansion.",
    defaultReportsToRoleKey: "ceo",
    defaultSkills: ["paperclip", "cro-routines"],
    defaultTools: ["attio", "gmail", "slack"],
    defaultModelTier: "power",
    hiringSignals: ["outbound sales", "design partners", "revenue targets"],
  },
  {
    roleKey: "cfo",
    title: "CFO",
    roleType: "executive",
    department: "finance",
    mandate: "Own budget control, cash planning, and financial reporting.",
    defaultReportsToRoleKey: "ceo",
    defaultSkills: ["paperclip"],
    defaultTools: ["stripe", "notion"],
    defaultModelTier: "standard",
    hiringSignals: ["tight budgets", "financial controls", "unit economics"],
  },
  {
    roleKey: "ciso",
    title: "CISO",
    roleType: "executive",
    department: "security",
    mandate: "Own security posture, data handling, and compliance controls.",
    defaultReportsToRoleKey: "ceo",
    defaultSkills: ["paperclip", "security-review"],
    defaultTools: ["github", "notion"],
    defaultModelTier: "standard",
    hiringSignals: ["regulated data", "security-sensitive workflows", "customer trust requirements"],
  },
  {
    roleKey: "backend-engineer",
    title: "Backend Engineer",
    roleType: "operator",
    department: "engineering",
    mandate: "Build APIs, business logic, and data integrations.",
    defaultReportsToRoleKey: "cto",
    defaultSkills: ["paperclip", "nodejs-backend-patterns"],
    defaultTools: ["github", "vercel"],
    defaultModelTier: "standard",
    hiringSignals: ["API delivery", "data pipelines", "integration work"],
  },
  {
    roleKey: "frontend-engineer",
    title: "Frontend Engineer",
    roleType: "operator",
    department: "engineering",
    mandate: "Deliver user-facing web experiences and review flows.",
    defaultReportsToRoleKey: "cto",
    defaultSkills: ["paperclip", "frontend-design"],
    defaultTools: ["github", "vercel"],
    defaultModelTier: "standard",
    hiringSignals: ["dashboard work", "review UI", "user-facing product"],
  },
  {
    roleKey: "qa-engineer",
    title: "QA Engineer",
    roleType: "operator",
    department: "engineering",
    mandate: "Verify product quality through regression and release checks.",
    defaultReportsToRoleKey: "cto",
    defaultSkills: ["paperclip", "javascript-testing-patterns"],
    defaultTools: ["github"],
    defaultModelTier: "lite",
    hiringSignals: ["quality gates", "release risk", "regression coverage"],
  },
  {
    roleKey: "devops-engineer",
    title: "DevOps Engineer",
    roleType: "operator",
    department: "engineering",
    mandate: "Own deployment pipelines and runtime reliability.",
    defaultReportsToRoleKey: "cto",
    defaultSkills: ["paperclip", "devops-rollout-plan"],
    defaultTools: ["github", "vercel"],
    defaultModelTier: "standard",
    hiringSignals: ["serving infrastructure", "runtime operations", "ci/cd"],
  },
  {
    roleKey: "product-designer",
    title: "Product Designer",
    roleType: "operator",
    department: "design",
    mandate: "Translate product strategy into user flows and interfaces.",
    defaultReportsToRoleKey: "cto",
    defaultSkills: ["paperclip", "ui-ux-pro-max"],
    defaultTools: ["figma", "notion"],
    defaultModelTier: "standard",
    hiringSignals: ["new product UX", "review workflows", "complex user journeys"],
  },
  {
    roleKey: "content-lead",
    title: "Content Lead",
    roleType: "operator",
    department: "marketing",
    mandate: "Operate the editorial pipeline and publishable asset creation.",
    defaultReportsToRoleKey: "cmo",
    defaultSkills: ["paperclip", "content-lead-routines"],
    defaultTools: ["notion", "slack"],
    defaultModelTier: "standard",
    hiringSignals: ["content engine", "SEO program", "editorial calendar"],
  },
  {
    roleKey: "seo-specialist",
    title: "SEO Specialist",
    roleType: "operator",
    department: "marketing",
    mandate: "Grow qualified traffic through search demand capture.",
    defaultReportsToRoleKey: "cmo",
    defaultSkills: ["paperclip"],
    defaultTools: ["google-drive", "notion"],
    defaultModelTier: "lite",
    hiringSignals: ["organic acquisition", "content discovery", "search demand"],
  },
  {
    roleKey: "sdr",
    title: "SDR",
    roleType: "operator",
    department: "sales",
    mandate: "Generate pipeline through outbound prospecting and qualification.",
    defaultReportsToRoleKey: "cro",
    defaultSkills: ["paperclip"],
    defaultTools: ["attio", "gmail", "slack"],
    defaultModelTier: "lite",
    hiringSignals: ["outbound motion", "pilot recruitment", "top-of-funnel targets"],
  },
  {
    roleKey: "account-executive",
    title: "Account Executive",
    roleType: "operator",
    department: "sales",
    mandate: "Own discovery, proposal, and close workflows.",
    defaultReportsToRoleKey: "cro",
    defaultSkills: ["paperclip"],
    defaultTools: ["attio", "gmail"],
    defaultModelTier: "standard",
    hiringSignals: ["high-ticket sales", "pipeline conversion", "pilot closes"],
  },
  {
    roleKey: "bookkeeper",
    title: "Bookkeeper",
    roleType: "operator",
    department: "finance",
    mandate: "Maintain transaction hygiene and reporting cadence.",
    defaultReportsToRoleKey: "cfo",
    defaultSkills: ["paperclip"],
    defaultTools: ["stripe", "notion"],
    defaultModelTier: "lite",
    hiringSignals: ["transaction-heavy business", "financial reporting", "expense controls"],
  },
  {
    roleKey: "security-engineer",
    title: "Security Engineer",
    roleType: "operator",
    department: "security",
    mandate: "Implement secure defaults and controls for sensitive systems.",
    defaultReportsToRoleKey: "ciso",
    defaultSkills: ["paperclip", "security-review"],
    defaultTools: ["github", "notion"],
    defaultModelTier: "standard",
    hiringSignals: ["customer data", "auth systems", "compliance controls"],
  },
] as const satisfies readonly z.input<typeof roleLibraryEntrySchema>[];

export const teamAssemblyRequestSchema = z.object({
  companyName: z.string().trim().min(1).optional(),
  normalizedGoalDocument: normalizedGoalDocumentSchema,
  prd: prdSchema.optional(),
  /** Hire flow passes [] — no built-in role catalog. */
  roleLibrary: z.array(roleLibraryEntrySchema).optional().default([]),
  /** Workspace integrations already connected (connector keys / tool slugs). */
  connectedToolSlugs: z.array(z.string().trim().min(1)).optional().default([]),
});

export type TeamAssemblyRequest = z.infer<typeof teamAssemblyRequestSchema>;
export type TeamAssemblyResult = z.infer<typeof teamAssemblyResultSchema>;
/** One staffed role's full spec — the shape both org-chart arrays and the
 *  provisioning plan carry. Exported for the chunked assembler (PR4). */
export type StaffingRecommendation = z.infer<typeof staffingRecommendationSchema>;

/**
 * Team-assembly prompt. Field expectations must stay aligned with
 * `dashboard/src/pages/HiringPlanReview.tsx` (display contract).
 */
export function buildTeamAssemblyPrompt(input: TeamAssemblyRequest): string {
  const companyName = input.companyName?.trim() || "Unnamed Company";
  const connected = input.connectedToolSlugs ?? [];
  const connectedBlock =
    connected.length > 0
      ? [
          "",
          "Integrations already connected in this workspace (prefer these tool slugs when relevant):",
          connected.join(", "),
        ]
      : [
          "",
          "Integrations already connected in this workspace: (none yet).",
        ];

  return [
    "You are the founding architect of an agentic AI team for a real company.",
    "Read the goal carefully. Design the team THAT GOAL needs — invent every role from the mission.",
    "Do not default to a generic startup template (e.g. CEO + two operators) unless the goal is truly that small.",
    "Every role must be load-bearing. Team size scales with mission complexity — from 2 roles to 15+ when warranted.",
    "",
    "Honor the user's instructions in the goal for depth, tone, and team shape:",
    "  - If they ask for verbose planning, write detailed mandates, justifications, and provisioning briefs.",
    "  - If they name platforms (e.g. heygen, buffer), include those exact kebab-case slugs in the relevant roles' tools[] arrays.",
    "  - Match role titles and departments to the work described — not generic labels like 'Strategy Lead' unless appropriate.",
    "",
    "You decide:",
    "  - WHICH roles exist (invent roleKey + title; no picking from a catalog)",
    "  - HOW MANY roles",
    "  - WHO each role reports to (reportsToRoleKey), plus each role's department and headcount",
    "  - mandate, justification, KPIs, skills, tools, modelTier, budgetMonthlyUsd, provisioningInstructions",
    "",
    "StaffingRecommendation quality:",
    "  - mandate: specific ownership for THIS mission; length matches what the user asked for.",
    "  - justification: why this role is essential to THIS goal — be concrete.",
    "  - kpis: 2-6 quantifiable outcomes; avoid vanity metrics.",
    "  - skills: concrete capabilities, not buzzwords.",
    "  - tools: kebab-case SaaS slugs the role actually uses; include every platform named in the goal; suggest extras only when essential.",
    "  - modelTier: lite | standard | power based on reasoning load.",
    "  - provisioningInstructions: actionable day-one brief for the agent.",
    "",
    "summary + rationale: written for the human reviewer — reference audience, channels, tools, and constraints from the goal.",
    "",
    "Output format:",
    "  - Return JSON only. No prose, no markdown fences.",
    `  - schemaVersion must be exactly "${TEAM_ASSEMBLY_SCHEMA_VERSION}".`,
    "  - provisioningPlan.agents must list every role exactly once (mirrors orgChart.executives + operators).",
    "  - reportingLines must reconcile with reportsToRoleKey on each role.",
    "",
    "Every StaffingRecommendation is an object that MUST include ALL of these fields — never omit any:",
    "  {",
    '    "roleKey": string,            // unique kebab-case id, e.g. "support-lead"',
    '    "title": string,              // human title, e.g. "Support Lead"',
    '    "roleType": "executive" | "operator",   // EXACTLY one of these two lowercase literals',
    '    "department": string,         // e.g. "support", "engineering" — required, never null/empty',
    '    "headcount": number,          // integer >= 1',
    '    "reportsToRoleKey": string | null,       // a roleKey in this plan, or null for the top role',
    '    "mandate": string,',
    '    "justification": string,',
    '    "kpis": [string, ...],        // at least one',
    '    "skills": [string, ...],      // at least one',
    '    "tools": [string, ...],       // at least one kebab-case slug',
    '    "modelTier": "lite" | "standard" | "power",',
    '    "budgetMonthlyUsd": number | null,',
    '    "provisioningInstructions": string',
    "  }",
    '  - In orgChart.executives every roleType MUST be "executive"; in orgChart.operators every roleType MUST be "operator".',
    "  - provisioningPlan.agents repeats every role once with these SAME fields (roleType matching its org-chart section).",
    "",
    "Return this JSON shape:",
    "{",
    `  "schemaVersion": "${TEAM_ASSEMBLY_SCHEMA_VERSION}",`,
    '  "company": { "name": string | null, "goal": string, "targetCustomer": string | null, "budget": string | null, "timeHorizon": string | null },',
    '  "summary": string,',
    '  "rationale": string,',
    '  "orgChart": { "executives": [StaffingRecommendation, ...], "operators": [StaffingRecommendation, ...], "reportingLines": [{ "managerRoleKey": string, "reportRoleKey": string }, ...] },',
    '  "provisioningPlan": { "teamName": string, "deploymentMode": "continuous_agents", "agents": [StaffingRecommendation, ...] },',
    '  "roadmap306090": { "day30": { "objectives": [string, ...], "deliverables": [string, ...], "ownerRoleKeys": [string, ...] }, "day60": {...}, "day90": {...} }',
    "}",
    "",
    `Company name: ${companyName}`,
    "",
    `Goal document:\n${JSON.stringify(input.normalizedGoalDocument, null, 2)}`,
    "",
    `PRD (optional, may be null):\n${JSON.stringify(input.prd ?? null, null, 2)}`,
    ...connectedBlock,
  ].join("\n");
}

export function parseTeamAssemblyResponse(rawText: string): TeamAssemblyResult {
  // Delegates the chatty-model tolerance to the shared extractor — see
  // src/engine/structuredOutput.ts for the resolution order. The zod
  // schema is enforced inside the extractor so a single candidate-pass
  // covers both "is this JSON?" and "is this the right shape?".
  return extractStructuredOutput<TeamAssemblyResult>(rawText, {
    schema: teamAssemblyResultSchema,
    label: "team-assembly",
  });
}
