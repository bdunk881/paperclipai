import { DEFAULT_ROLE_LIBRARY } from "../goals/teamAssembly";
import type { TeamAssemblyResult } from "../goals/teamAssembly";

const EXECUTIVE_DEFAULT_KPIS = [
  "Quarterly OKR completion %",
  "Cross-team unblocks per month",
  "Direct-report capacity utilization",
];

const OPERATOR_DEFAULT_KPIS = [
  "Throughput vs target",
  "First-response time",
  "Quality score (errors per task)",
];

/** Used by live-team add-report flow only — not the hire/plan customer path. */
export function libraryEntryToRecommendation(
  entry: (typeof DEFAULT_ROLE_LIBRARY)[number],
  existingRoleKeys: Set<string>,
): TeamAssemblyResult["provisioningPlan"]["agents"][number] {
  const reportsToRoleKey =
    entry.defaultReportsToRoleKey != null && existingRoleKeys.has(entry.defaultReportsToRoleKey)
      ? (entry.defaultReportsToRoleKey as string)
      : null;
  return {
    roleKey: entry.roleKey as string,
    title: entry.title,
    roleType: entry.roleType,
    department: entry.department,
    headcount: 1,
    reportsToRoleKey,
    mandate: entry.mandate,
    justification: "Pre-built role added from library.",
    kpis:
      entry.roleType === "executive" ? [...EXECUTIVE_DEFAULT_KPIS] : [...OPERATOR_DEFAULT_KPIS],
    skills: [...(entry.defaultSkills as string[])],
    tools: entry.defaultTools.length > 0 ? [...(entry.defaultTools as string[])] : ["notion"],
    modelTier: entry.defaultModelTier,
    budgetMonthlyUsd: null,
    provisioningInstructions:
      "Brief this role on your company's specific goals and KPIs on day one.",
  };
}
