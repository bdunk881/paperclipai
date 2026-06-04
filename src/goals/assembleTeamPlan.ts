/**
 * PR4 — the "reduce" stage of chunked team-assembly generation.
 * (Project: Chunked team-assembly generation — HEL-552.)
 *
 * Merges the skeleton (structure + framing + roadmap) with the per-role fill
 * details into the canonical `TeamAssemblyResult`, then validates against the
 * EXISTING `teamAssemblyResultSchema` — the single source of truth, so the
 * output is byte-for-byte the same shape the single-call path produced and
 * every downstream consumer is unaffected.
 *
 * Two notable properties:
 *   - `provisioningPlan.agents` is DERIVED from the org chart, not separately
 *     generated — this is what kills the 2× duplication that made the
 *     single-call response overrun the token cap.
 *   - referential integrity is checked up front (every reportsToRoleKey /
 *     reportingLine / roadmap ownerRoleKey must reference a real role, and
 *     every role must have a fill) so a partial/garbled generation throws a
 *     precise, actionable error the orchestrator can retry on.
 */

import {
  TEAM_ASSEMBLY_SCHEMA_VERSION,
  teamAssemblyResultSchema,
  type StaffingRecommendation,
  type TeamAssemblyResult,
} from "./teamAssembly";
import type { TeamSkeleton } from "./teamSkeleton";
import type { RoleDetail } from "./roleDetail";

export function assembleTeamPlan(
  skeleton: TeamSkeleton,
  fills: Record<string, RoleDetail>,
): TeamAssemblyResult {
  // 1. Every role must have a fill.
  const missing = skeleton.roles
    .filter((r) => !Object.prototype.hasOwnProperty.call(fills, r.roleKey))
    .map((r) => r.roleKey);
  if (missing.length > 0) {
    throw new Error(`assembleTeamPlan: missing role details for: ${missing.join(", ")}`);
  }

  // 2. Referential integrity: every roleKey reference must resolve to a role.
  const roleKeys = new Set(skeleton.roles.map((r) => r.roleKey));
  const danglers: string[] = [];
  for (const r of skeleton.roles) {
    if (r.reportsToRoleKey && !roleKeys.has(r.reportsToRoleKey)) {
      danglers.push(`role "${r.roleKey}".reportsToRoleKey -> "${r.reportsToRoleKey}"`);
    }
  }
  for (const line of skeleton.reportingLines) {
    if (!roleKeys.has(line.managerRoleKey)) {
      danglers.push(`reportingLine.managerRoleKey -> "${line.managerRoleKey}"`);
    }
    if (!roleKeys.has(line.reportRoleKey)) {
      danglers.push(`reportingLine.reportRoleKey -> "${line.reportRoleKey}"`);
    }
  }
  const phases: Array<[string, { ownerRoleKeys: string[] }]> = [
    ["day30", skeleton.roadmap306090.day30],
    ["day60", skeleton.roadmap306090.day60],
    ["day90", skeleton.roadmap306090.day90],
  ];
  for (const [name, phase] of phases) {
    for (const key of phase.ownerRoleKeys) {
      if (!roleKeys.has(key)) {
        danglers.push(`roadmap.${name}.ownerRoleKeys -> "${key}"`);
      }
    }
  }
  if (danglers.length > 0) {
    throw new Error(`assembleTeamPlan: dangling roleKey references: ${danglers.join("; ")}`);
  }

  // 3. Merge skeleton role + fill detail into a full StaffingRecommendation.
  const agents: StaffingRecommendation[] = skeleton.roles.map((r) => {
    const detail = fills[r.roleKey];
    return {
      roleKey: r.roleKey,
      title: r.title,
      roleType: r.roleType,
      department: r.department,
      headcount: 1,
      reportsToRoleKey: r.reportsToRoleKey,
      mandate: detail.mandate,
      justification: detail.justification,
      kpis: detail.kpis,
      skills: detail.skills,
      tools: detail.tools,
      modelTier: detail.modelTier,
      budgetMonthlyUsd: detail.budgetMonthlyUsd,
      provisioningInstructions: detail.provisioningInstructions,
    };
  });
  const executives = agents.filter((a) => a.roleType === "executive");
  const operators = agents.filter((a) => a.roleType === "operator");

  const assembled = {
    schemaVersion: TEAM_ASSEMBLY_SCHEMA_VERSION,
    company: skeleton.company,
    summary: skeleton.summary,
    rationale: skeleton.rationale,
    orgChart: {
      executives,
      operators,
      reportingLines: skeleton.reportingLines,
    },
    provisioningPlan: {
      teamName: skeleton.teamName,
      deploymentMode: "continuous_agents" as const,
      // Derived from the org chart — never separately generated.
      agents: [...executives, ...operators],
    },
    roadmap306090: skeleton.roadmap306090,
  };

  // 4. Validate against the canonical schema (single source of truth).
  return teamAssemblyResultSchema.parse(assembled);
}
