import type { TeamAssemblyResult } from "../goals/teamAssembly";

/** Persisted alongside TeamAssemblyResult in hiring_plans.draft jsonb. */
export interface HiringPlanSelection {
  includedRoleKeys: string[];
}

export interface HiringPlanGenerationMeta {
  provider: string;
  model: string;
  llmConfigId: string | null;
}

export type HiringPlanDraft = TeamAssemblyResult & {
  selection?: HiringPlanSelection;
  generationMeta?: HiringPlanGenerationMeta;
};

export function allRoleKeysFromDraft(draft: TeamAssemblyResult): string[] {
  return draft.provisioningPlan.agents.map((agent) => agent.roleKey);
}

export function defaultIncludedRoleKeys(draft: TeamAssemblyResult): string[] {
  return allRoleKeysFromDraft(draft);
}

export function resolveIncludedRoleKeys(
  draft: HiringPlanDraft,
  override?: string[] | null,
): string[] {
  if (override && override.length > 0) {
    return override;
  }
  if (draft.selection?.includedRoleKeys?.length) {
    return draft.selection.includedRoleKeys;
  }
  return defaultIncludedRoleKeys(draft);
}

export function attachDefaultSelection(draft: TeamAssemblyResult): HiringPlanDraft {
  return {
    ...draft,
    selection: { includedRoleKeys: defaultIncludedRoleKeys(draft) },
  };
}

export function validateIncludedRoleKeys(
  draft: TeamAssemblyResult,
  includedRoleKeys: string[],
): string | null {
  if (includedRoleKeys.length === 0) {
    return "At least one agent must be selected";
  }
  const known = new Set(allRoleKeysFromDraft(draft));
  const unknown = includedRoleKeys.filter((key) => !known.has(key));
  if (unknown.length > 0) {
    return `Unknown role keys: ${unknown.join(", ")}`;
  }
  return null;
}

/**
 * Returns a TeamAssemblyResult containing only selected agents, with
 * reporting lines pruned and reportsToRoleKey cleared when the manager
 * was deselected.
 */
export function filterDraftByIncludedRoleKeys(
  draft: HiringPlanDraft,
  includedRoleKeys: string[],
): TeamAssemblyResult {
  const included = new Set(includedRoleKeys);
  const mapAgent = (
    agent: TeamAssemblyResult["provisioningPlan"]["agents"][number],
  ) => ({
    ...agent,
    reportsToRoleKey:
      agent.reportsToRoleKey && included.has(agent.reportsToRoleKey)
        ? agent.reportsToRoleKey
        : null,
  });

  const agents = draft.provisioningPlan.agents
    .filter((agent) => included.has(agent.roleKey))
    .map(mapAgent);
  const executives = draft.orgChart.executives
    .filter((agent) => included.has(agent.roleKey))
    .map(mapAgent);
  const operators = draft.orgChart.operators
    .filter((agent) => included.has(agent.roleKey))
    .map(mapAgent);
  const reportingLines = draft.orgChart.reportingLines.filter(
    (line) => included.has(line.managerRoleKey) && included.has(line.reportRoleKey),
  );

  const { selection: _selection, generationMeta: _meta, ...plan } = draft;
  return {
    ...plan,
    orgChart: { executives, operators, reportingLines },
    provisioningPlan: {
      ...plan.provisioningPlan,
      agents,
    },
  };
}
