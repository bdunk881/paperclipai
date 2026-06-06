/**
 * PR2 — the "skeleton" stage of chunked team-assembly generation.
 * (Project: Chunked team-assembly generation — HEL-550.)
 *
 * Produces the org STRUCTURE + framing + roadmap in a single small call: who
 * is on the team, the reporting hierarchy, and the 30/60/90 plan — but NOT the
 * heavy per-agent fields (mandate / justification / kpis / skills / tools /
 * provisioningInstructions). Those are filled per-role-batch in PR3. Keeping
 * this response small makes it reliable to parse even for large teams, which
 * is the whole point of chunking (vs. one call that truncates at the cap).
 */

import { z } from "zod";
import { extractStructuredOutput } from "../engine/structuredOutput";
import {
  TEAM_ASSEMBLY_SCHEMA_VERSION,
  phasePlanSchema,
  type TeamAssemblyRequest,
} from "./teamAssembly";

const skeletonRoleSchema = z.object({
  roleKey: z.string().trim().min(1),
  title: z.string().trim().min(1),
  roleType: z.enum(["executive", "operator"]),
  department: z.string().trim().min(1),
  reportsToRoleKey: z.string().trim().min(1).nullable(),
});

export const teamSkeletonSchema = z.object({
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
  teamName: z.string().trim().min(1),
  roles: z.array(skeletonRoleSchema).min(1),
  reportingLines: z.array(
    z.object({
      managerRoleKey: z.string().trim().min(1),
      reportRoleKey: z.string().trim().min(1),
    }),
  ),
  roadmap306090: z.object({
    day30: phasePlanSchema,
    day60: phasePlanSchema,
    day90: phasePlanSchema,
  }),
});

export type TeamSkeleton = z.infer<typeof teamSkeletonSchema>;
export type TeamSkeletonRole = z.infer<typeof skeletonRoleSchema>;

/**
 * Prompt for the skeleton call. Mirrors `buildTeamAssemblyPrompt`'s framing
 * but asks ONLY for structure + framing + roadmap — explicitly deferring the
 * heavy per-agent fields to the fill stage.
 */
export function buildTeamSkeletonPrompt(input: TeamAssemblyRequest): string {
  const companyName = input.companyName?.trim() || "Unnamed Company";
  // HEL-761: prefer the Composio connected set when present (else the legacy
  // connectedToolSlugs). The skeleton defers tools[] to the fill stage, so this
  // is "consider when shaping roles" only — the connectable catalog is surfaced
  // at fill time (buildRoleDetailPrompt), not here.
  const connected =
    input.composioToolkits?.connected.map((t) => t.slug) ?? input.connectedToolSlugs ?? [];
  const connectedBlock =
    connected.length > 0
      ? ["", "Integrations already connected (consider when shaping roles): " + connected.join(", ")]
      : ["", "Integrations already connected: (none yet)."];

  return [
    "You are the founding architect of an agentic AI team for a real company.",
    "Read the goal carefully and design the team STRUCTURE that goal needs — invent every role from the mission.",
    "Do NOT default to a generic startup template (e.g. CEO + two operators) unless the goal is truly that small.",
    "Team size scales with mission complexity — from 2 roles to 15+ when warranted. Every role must be load-bearing.",
    "",
    "THIS STEP IS STRUCTURE ONLY. Do NOT write mandates, justifications, KPIs, skills, tools, or day-one briefs yet —",
    "a later step fills those in per role. Here you decide WHO exists and HOW they report, plus the framing and roadmap.",
    "",
    "Each role needs: a unique kebab-case roleKey, a human title, roleType (executive | operator), a department,",
    "and reportsToRoleKey (a roleKey in this plan, or null for the single top role).",
    "reportingLines must reconcile with each role's reportsToRoleKey. roadmap ownerRoleKeys must reference roleKeys you define.",
    "",
    "Output format:",
    "  - Return JSON only. No prose, no markdown fences.",
    `  - schemaVersion must be exactly "${TEAM_ASSEMBLY_SCHEMA_VERSION}".`,
    "  - roleKeys must be unique across the plan.",
    "",
    "Return this JSON shape:",
    "{",
    `  "schemaVersion": "${TEAM_ASSEMBLY_SCHEMA_VERSION}",`,
    '  "company": { "name": string | null, "goal": string, "targetCustomer": string | null, "budget": string | null, "timeHorizon": string | null },',
    '  "summary": string,                  // for the human reviewer: audience, channels, constraints from the goal',
    '  "rationale": string,                // why this team shape fits the goal',
    '  "teamName": string,                 // a short, human name for the team',
    '  "roles": [ { "roleKey": string, "title": string, "roleType": "executive" | "operator", "department": string, "reportsToRoleKey": string | null }, ... ],',
    '  "reportingLines": [ { "managerRoleKey": string, "reportRoleKey": string }, ... ],',
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

export function parseTeamSkeletonResponse(rawText: string): TeamSkeleton {
  return extractStructuredOutput<TeamSkeleton>(rawText, {
    schema: teamSkeletonSchema,
    label: "team-skeleton",
  });
}
