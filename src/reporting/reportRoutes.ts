import express from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { controlPlaneStore } from "../controlPlane/controlPlaneStore";
import { stripeConnectorService } from "../integrations/stripe/service";
import { reportStore } from "./reportStore";
import {
  buildDelivery,
  createBoardMemoReport,
  createFinancialStatementReport,
  createPostmortemReport,
  resolveWindow,
} from "./reportService";
import { ReportKind, ReportTemplateConfig } from "./types";

const router = express.Router();

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function requireRunId(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const runId = req.header("X-Paperclip-Run-Id");
  if (!runId?.trim()) {
    res.status(400).json({ error: "X-Paperclip-Run-Id header is required for report generation" });
    return;
  }
  next();
}

function parseKind(value: unknown): ReportKind | null {
  return value === "board_memo" || value === "financial_statement" || value === "postmortem"
    ? value
    : null;
}

function parseTemplate(value: unknown): ReportTemplateConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const template = value as Record<string, unknown>;
  return {
    headline: typeof template.headline === "string" ? template.headline : undefined,
    footerNote: typeof template.footerNote === "string" ? template.footerNote : undefined,
    sectionTitles: Array.isArray(template.sectionTitles)
      ? template.sectionTitles.filter((entry): entry is string => typeof entry === "string")
      : undefined,
  };
}

router.get("/", async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const kind = parseKind(req.query.kind);
  const teamId = typeof req.query.teamId === "string" && req.query.teamId.trim() ? req.query.teamId.trim() : undefined;
  const reports = await reportStore.listByUser(userId, { kind: kind ?? undefined, teamId });
  res.json({ reports, total: reports.length });
});

router.get("/:id", async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const report = await reportStore.getById(req.params.id, userId);
  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json({ report });
});

router.post("/generate", requireRunId, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const kind = parseKind(req.body?.kind);
  if (!kind) {
    res.status(400).json({ error: "kind must be one of board_memo, financial_statement, or postmortem" });
    return;
  }

  const teamId = typeof req.body?.teamId === "string" && req.body.teamId.trim() ? req.body.teamId.trim() : undefined;
  const template = parseTemplate(req.body?.template);
  const delivery = buildDelivery(req.body?.deliveryChannels, typeof req.body?.recipientEmail === "string" ? req.body.recipientEmail : undefined);
  const window = resolveWindow(
    typeof req.body?.periodStart === "string" ? req.body.periodStart : undefined,
    typeof req.body?.periodEnd === "string" ? req.body.periodEnd : undefined
  );

  try {
    let generated;

    if (kind === "board_memo") {
      if (!teamId) {
        res.status(400).json({ error: "teamId is required for board_memo reports" });
        return;
      }

      const team = controlPlaneStore.getTeam(teamId, userId);
      if (!team) {
        res.status(404).json({ error: "Team not found" });
        return;
      }

      generated = createBoardMemoReport({
        team,
        tasks: controlPlaneStore.listTasks(userId, teamId),
        executions: controlPlaneStore.listExecutions(userId, teamId),
        agents: controlPlaneStore.listAgents(teamId, userId),
        window,
        template,
        delivery,
      });
    } else if (kind === "financial_statement") {
      const financialInputs = req.body?.financialInputs && typeof req.body.financialInputs === "object" && !Array.isArray(req.body.financialInputs)
        ? req.body.financialInputs as Record<string, unknown>
        : {};

      const [invoices, paymentIntents, subscriptions] = await Promise.all([
        stripeConnectorService.listInvoices(userId, { limit: typeof financialInputs.limit === "number" ? financialInputs.limit : 100 }),
        stripeConnectorService.listPaymentIntents(userId, { limit: typeof financialInputs.limit === "number" ? financialInputs.limit : 100 }),
        stripeConnectorService.listSubscriptions(userId, { limit: typeof financialInputs.limit === "number" ? financialInputs.limit : 100 }),
      ]);

      generated = createFinancialStatementReport({
        teamId,
        invoices,
        paymentIntents,
        subscriptions,
        window,
        template,
        delivery,
        openingCashMinor: typeof financialInputs.openingCashMinor === "number" ? financialInputs.openingCashMinor : undefined,
        operatingExpensesMinor: typeof financialInputs.operatingExpensesMinor === "number" ? financialInputs.operatingExpensesMinor : undefined,
      });
    } else {
      const postmortem = req.body?.postmortem && typeof req.body.postmortem === "object" && !Array.isArray(req.body.postmortem)
        ? req.body.postmortem as Record<string, unknown>
        : null;

      if (!postmortem || typeof postmortem.initiativeName !== "string" || !postmortem.initiativeName.trim()) {
        res.status(400).json({ error: "postmortem.initiativeName is required for postmortem reports" });
        return;
      }
      if (typeof postmortem.cancelledAt !== "string" || !postmortem.cancelledAt.trim()) {
        res.status(400).json({ error: "postmortem.cancelledAt is required for postmortem reports" });
        return;
      }

      generated = createPostmortemReport({
        teamId,
        initiativeName: postmortem.initiativeName.trim(),
        cancelledAt: postmortem.cancelledAt.trim(),
        summary: typeof postmortem.summary === "string" ? postmortem.summary : undefined,
        reason: typeof postmortem.reason === "string" ? postmortem.reason : undefined,
        impact: typeof postmortem.impact === "string" ? postmortem.impact : undefined,
        owner: typeof postmortem.owner === "string" ? postmortem.owner : undefined,
        correctiveActions: Array.isArray(postmortem.correctiveActions)
          ? postmortem.correctiveActions.filter((entry): entry is string => typeof entry === "string")
          : undefined,
        template,
        delivery,
      });
    }

    const report = await reportStore.save({ userId, ...generated });
    res.status(201).json({ report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected report generation failure";
    res.status(500).json({ error: message });
  }
});

export default router;
