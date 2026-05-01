import express from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { controlPlaneStore } from "../controlPlane/controlPlaneStore";
import { CompanyProvisioningAgentInput } from "../controlPlane/types";

const router = express.Router();

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function requirePaperclipRunId(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const runId = req.header("X-Paperclip-Run-Id");
  if (!runId || !runId.trim()) {
    res.status(400).json({ error: "X-Paperclip-Run-Id header is required for mutating company requests" });
    return;
  }
  next();
}

router.post("/", requirePaperclipRunId, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const {
    name,
    workspaceName,
    externalCompanyId,
    idempotencyKey,
    budgetMonthlyUsd,
    orchestrationEnabled,
    secretBindings,
    agents,
  } = req.body as {
    name?: unknown;
    workspaceName?: unknown;
    externalCompanyId?: unknown;
    idempotencyKey?: unknown;
    budgetMonthlyUsd?: unknown;
    orchestrationEnabled?: unknown;
    secretBindings?: unknown;
    agents?: unknown;
  };

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required and must be a non-empty string" });
    return;
  }
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    res.status(400).json({ error: "idempotencyKey is required and must be a non-empty string" });
    return;
  }
  if (typeof budgetMonthlyUsd !== "number" || budgetMonthlyUsd < 0) {
    res.status(400).json({ error: "budgetMonthlyUsd is required and must be a non-negative number" });
    return;
  }
  if (workspaceName !== undefined && (typeof workspaceName !== "string" || !workspaceName.trim())) {
    res.status(400).json({ error: "workspaceName must be a non-empty string when provided" });
    return;
  }
  if (
    externalCompanyId !== undefined &&
    (typeof externalCompanyId !== "string" || !externalCompanyId.trim())
  ) {
    res.status(400).json({ error: "externalCompanyId must be a non-empty string when provided" });
    return;
  }
  if (orchestrationEnabled !== undefined && typeof orchestrationEnabled !== "boolean") {
    res.status(400).json({ error: "orchestrationEnabled must be a boolean when provided" });
    return;
  }
  if (!secretBindings || typeof secretBindings !== "object" || Array.isArray(secretBindings)) {
    res.status(400).json({ error: "secretBindings is required and must be an object" });
    return;
  }
  if (!Array.isArray(agents) || agents.length === 0) {
    res.status(400).json({ error: "agents is required and must be a non-empty array" });
    return;
  }

  const parsedSecretBindings = Object.entries(secretBindings).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === "string" && value.trim()) {
      acc[key] = value.trim();
    }
    return acc;
  }, {});
  if (Object.keys(parsedSecretBindings).length === 0) {
    res.status(400).json({ error: "secretBindings must contain at least one non-empty secret value" });
    return;
  }

  const parsedAgents: CompanyProvisioningAgentInput[] = [];
  for (const agent of agents) {
    if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
      res.status(400).json({ error: "each agent must be an object" });
      return;
    }

    const { roleTemplateId, name: agentName, budgetMonthlyUsd: agentBudgetMonthlyUsd, model, instructions, skills } =
      agent as {
        roleTemplateId?: unknown;
        name?: unknown;
        budgetMonthlyUsd?: unknown;
        model?: unknown;
        instructions?: unknown;
        skills?: unknown;
      };

    if (typeof roleTemplateId !== "string" || !roleTemplateId.trim()) {
      res.status(400).json({ error: "each agent requires a non-empty roleTemplateId" });
      return;
    }
    if (agentName !== undefined && (typeof agentName !== "string" || !agentName.trim())) {
      res.status(400).json({ error: "agent name must be a non-empty string when provided" });
      return;
    }
    if (
      agentBudgetMonthlyUsd !== undefined &&
      (typeof agentBudgetMonthlyUsd !== "number" || agentBudgetMonthlyUsd < 0)
    ) {
      res.status(400).json({ error: "agent budgetMonthlyUsd must be a non-negative number when provided" });
      return;
    }
    if (model !== undefined && (typeof model !== "string" || !model.trim())) {
      res.status(400).json({ error: "agent model must be a non-empty string when provided" });
      return;
    }
    if (instructions !== undefined && (typeof instructions !== "string" || !instructions.trim())) {
      res.status(400).json({ error: "agent instructions must be a non-empty string when provided" });
      return;
    }
    if (
      skills !== undefined &&
      (!Array.isArray(skills) || skills.some((skill) => typeof skill !== "string" || !skill.trim()))
    ) {
      res.status(400).json({ error: "agent skills must be an array of non-empty strings when provided" });
      return;
    }

    parsedAgents.push({
      roleTemplateId: roleTemplateId.trim(),
      name: typeof agentName === "string" ? agentName.trim() : undefined,
      budgetMonthlyUsd: typeof agentBudgetMonthlyUsd === "number" ? agentBudgetMonthlyUsd : undefined,
      model: typeof model === "string" ? model.trim() : undefined,
      instructions: typeof instructions === "string" ? instructions.trim() : undefined,
      skills: Array.isArray(skills) ? skills.map((skill) => skill.trim()) : undefined,
    });
  }

  try {
    const result = controlPlaneStore.provisionCompanyWorkspace({
      userId,
      name: name.trim(),
      workspaceName: typeof workspaceName === "string" ? workspaceName.trim() : undefined,
      externalCompanyId: typeof externalCompanyId === "string" ? externalCompanyId.trim() : undefined,
      idempotencyKey: idempotencyKey.trim(),
      budgetMonthlyUsd,
      orchestrationEnabled: typeof orchestrationEnabled === "boolean" ? orchestrationEnabled : undefined,
      secretBindings: parsedSecretBindings,
      agents: parsedAgents,
    });

    res.status(result.idempotentReplay ? 200 : 201).json(result);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("unknown_role_template:")) {
      res.status(400).json({ error: `Unknown role template: ${error.message.slice("unknown_role_template:".length)}` });
      return;
    }
    if (error instanceof Error && error.message.startsWith("invalid_skills:")) {
      res.status(400).json({ error: `Unknown skills requested: ${error.message.slice("invalid_skills:".length)}` });
      return;
    }
    if (error instanceof Error && error.message === "budget_exceeded") {
      res.status(400).json({ error: "Allocated agent budgets exceed the company budget cap" });
      return;
    }
    if (error instanceof Error && error.message === "idempotency_conflict") {
      res.status(409).json({ error: "idempotencyKey was already used with a different provisioning payload" });
      return;
    }
    res.status(500).json({ error: "Unexpected company provisioning failure" });
  }
});

export default router;
