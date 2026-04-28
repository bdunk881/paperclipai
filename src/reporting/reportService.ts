import { ControlPlaneAgent, ControlPlaneExecution, ControlPlaneTask, ControlPlaneTeam } from "../controlPlane/types";
import { StripeInvoice, StripePaymentIntent, StripeSubscription } from "../integrations/stripe/types";
import { ReportDelivery, ReportMetric, ReportSection, ReportTemplateConfig } from "./types";

export interface ReportWindow {
  periodStart: string;
  periodEnd: string;
}

export interface BoardMemoInput {
  team: ControlPlaneTeam;
  tasks: ControlPlaneTask[];
  executions: ControlPlaneExecution[];
  agents: ControlPlaneAgent[];
  window: ReportWindow;
  template?: ReportTemplateConfig;
  delivery?: ReportDelivery[];
}

export interface FinancialStatementInput {
  teamId?: string;
  invoices: StripeInvoice[];
  paymentIntents: StripePaymentIntent[];
  subscriptions: StripeSubscription[];
  window: ReportWindow;
  template?: ReportTemplateConfig;
  delivery?: ReportDelivery[];
  openingCashMinor?: number;
  operatingExpensesMinor?: number;
}

export interface PostmortemInput {
  teamId?: string;
  initiativeName: string;
  cancelledAt: string;
  summary?: string;
  reason?: string;
  impact?: string;
  owner?: string;
  correctiveActions?: string[];
  template?: ReportTemplateConfig;
  delivery?: ReportDelivery[];
}

function withinWindow(timestamp: string | undefined, window: ReportWindow): boolean {
  if (!timestamp) {
    return false;
  }
  const value = new Date(timestamp).getTime();
  return value >= new Date(window.periodStart).getTime() && value <= new Date(window.periodEnd).getTime();
}

function formatDateRange(window: ReportWindow): string {
  return `${window.periodStart.slice(0, 10)} to ${window.periodEnd.slice(0, 10)}`;
}

function metric(key: string, label: string, value: number | string, unit?: ReportMetric["unit"]): ReportMetric {
  return { key, label, value, unit };
}

function sectionTitle(index: number, fallback: string, template?: ReportTemplateConfig): string {
  const configured = template?.sectionTitles?.[index];
  return typeof configured === "string" && configured.trim() ? configured.trim() : fallback;
}

export function resolveWindow(periodStart?: string, periodEnd?: string): ReportWindow {
  const end = periodEnd ? new Date(periodEnd) : new Date();
  const start = periodStart ? new Date(periodStart) : new Date(end.getTime() - (7 * 24 * 60 * 60 * 1000));
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  };
}

export function buildDelivery(channels: unknown, recipientEmail?: string): ReportDelivery[] {
  const requested: Array<"inbox" | "email"> = Array.isArray(channels)
    ? channels.filter((value): value is "inbox" | "email" => value === "inbox" || value === "email")
    : ["inbox"];
  const unique = requested.length > 0
    ? Array.from(new Set<"inbox" | "email">(requested))
    : ["inbox"];
  const sentAt = new Date().toISOString();
  const delivery: ReportDelivery[] = [];

  for (const channel of unique) {
    if (channel === "inbox") {
      delivery.push({ channel: "inbox", status: "sent", sentAt });
      continue;
    }

    if (!recipientEmail?.trim()) {
      delivery.push({ channel: "email", status: "failed", error: "recipientEmail is required for email delivery" });
      continue;
    }

    delivery.push({ channel: "email", status: "pending", recipient: recipientEmail.trim() });
  }

  return delivery;
}

export function createBoardMemoReport(input: BoardMemoInput) {
  const tasksInWindow = input.tasks.filter((task) => withinWindow(task.updatedAt || task.createdAt, input.window));
  const executionsInWindow = input.executions.filter((execution) =>
    withinWindow(execution.lastHeartbeatAt || execution.startedAt || execution.requestedAt, input.window)
  );
  const doneCount = tasksInWindow.filter((task) => task.status === "done").length;
  const blockedCount = tasksInWindow.filter((task) => task.status === "blocked").length;
  const activeAgents = input.agents.filter((agent) => agent.status === "active").length;
  const runningExecutions = executionsInWindow.filter((execution) => execution.status === "running").length;

  const highlights = [
    `${doneCount} task(s) moved to done during ${formatDateRange(input.window)}.`,
    `${executionsInWindow.length} execution(s) produced activity across the team.`,
    `${activeAgents} active agent(s) are currently attached to ${input.team.name}.`,
  ];

  const blockers = blockedCount > 0
    ? tasksInWindow
      .filter((task) => task.status === "blocked")
      .slice(0, 5)
      .map((task) => `- ${task.title}`)
    : ["- No blocked tasks recorded in this reporting window."];

  const summary = `${input.team.name} closed ${doneCount} tasks, has ${blockedCount} blocker(s), and ran ${executionsInWindow.length} execution(s) in the reporting window.`;
  const sections: ReportSection[] = [
    {
      title: sectionTitle(0, "Highlights", input.template),
      body: highlights.join("\n"),
    },
    {
      title: sectionTitle(1, "Progress", input.template),
      body: `Completed tasks: ${doneCount}\nOpen tasks in window: ${tasksInWindow.length - doneCount}\nRunning executions: ${runningExecutions}`,
    },
    {
      title: sectionTitle(2, "Blockers", input.template),
      body: blockers.join("\n"),
    },
    {
      title: sectionTitle(3, "Next Focus", input.template),
      body: blockedCount > 0
        ? "Resolve the blocked items first, then convert open in-progress work into completed deliverables."
        : "Maintain execution cadence and convert remaining open work into completed deliverables next week.",
    },
  ];

  return {
    teamId: input.team.id,
    kind: "board_memo" as const,
    title: input.template?.headline?.trim() || `${input.team.name} board memo`,
    summary,
    periodStart: input.window.periodStart,
    periodEnd: input.window.periodEnd,
    template: input.template ?? {},
    sections,
    metrics: [
      metric("tasks_completed", "Tasks completed", doneCount, "count"),
      metric("tasks_blocked", "Blocked tasks", blockedCount, "count"),
      metric("active_agents", "Active agents", activeAgents, "count"),
      metric("executions", "Executions in window", executionsInWindow.length, "count"),
    ],
    delivery: input.delivery ?? [],
    source: {
      teamId: input.team.id,
      taskCount: tasksInWindow.length,
      executionCount: executionsInWindow.length,
      agentCount: input.agents.length,
    },
  };
}

export function createFinancialStatementReport(input: FinancialStatementInput) {
  const invoices = input.invoices.filter((invoice) => withinWindow(invoice.createdAt, input.window));
  const paymentIntents = input.paymentIntents.filter((paymentIntent) => withinWindow(paymentIntent.createdAt, input.window));
  const paidRevenueMinor = invoices
    .filter((invoice) => invoice.status === "paid")
    .reduce((sum, invoice) => sum + (invoice.total ?? 0), 0);
  const outstandingReceivablesMinor = invoices
    .filter((invoice) => invoice.status === "open")
    .reduce((sum, invoice) => sum + (invoice.total ?? 0), 0);
  const collectedCashMinor = paymentIntents
    .filter((paymentIntent) => paymentIntent.status === "succeeded")
    .reduce((sum, paymentIntent) => sum + paymentIntent.amount, 0);
  const operatingExpensesMinor = input.operatingExpensesMinor ?? 0;
  const cashPositionMinor = (input.openingCashMinor ?? 0) + collectedCashMinor - operatingExpensesMinor;
  const burnRateMinor = Math.max(0, operatingExpensesMinor - collectedCashMinor);
  const activeSubscriptions = input.subscriptions.filter((subscription) =>
    subscription.status === "active" || subscription.status === "trialing"
  ).length;

  const summary = operatingExpensesMinor > 0
    ? `Recognized revenue was ${paidRevenueMinor} minor units, cash collections were ${collectedCashMinor}, and modeled burn for the window was ${burnRateMinor}.`
    : `Recognized revenue was ${paidRevenueMinor} minor units and cash collections were ${collectedCashMinor}. Burn rate remains unavailable until operating expenses are supplied.`;

  const sections: ReportSection[] = [
    {
      title: sectionTitle(0, "Profit and Loss", input.template),
      body: `Recognized revenue: ${paidRevenueMinor}\nOperating expenses: ${operatingExpensesMinor}\nNet operating result: ${paidRevenueMinor - operatingExpensesMinor}`,
    },
    {
      title: sectionTitle(1, "Cash Position", input.template),
      body: `Opening cash: ${input.openingCashMinor ?? 0}\nCash collected: ${collectedCashMinor}\nEstimated closing cash: ${cashPositionMinor}`,
    },
    {
      title: sectionTitle(2, "Receivables", input.template),
      body: `Outstanding receivables: ${outstandingReceivablesMinor}\nInvoices in window: ${invoices.length}\nSuccessful payment intents: ${paymentIntents.filter((paymentIntent) => paymentIntent.status === "succeeded").length}`,
    },
    {
      title: sectionTitle(3, "Subscription Base", input.template),
      body: `Active or trialing subscriptions: ${activeSubscriptions}\nTotal subscriptions observed: ${input.subscriptions.length}`,
    },
  ];

  return {
    teamId: input.teamId,
    kind: "financial_statement" as const,
    title: input.template?.headline?.trim() || "Financial statement",
    summary,
    periodStart: input.window.periodStart,
    periodEnd: input.window.periodEnd,
    template: input.template ?? {},
    sections,
    metrics: [
      metric("recognized_revenue_minor", "Recognized revenue", paidRevenueMinor, "currency_minor"),
      metric("cash_collected_minor", "Cash collected", collectedCashMinor, "currency_minor"),
      metric("cash_position_minor", "Estimated closing cash", cashPositionMinor, "currency_minor"),
      metric("burn_rate_minor", "Modeled burn rate", burnRateMinor, "currency_minor"),
      metric("outstanding_receivables_minor", "Outstanding receivables", outstandingReceivablesMinor, "currency_minor"),
      metric("active_subscriptions", "Active subscriptions", activeSubscriptions, "count"),
    ],
    delivery: input.delivery ?? [],
    source: {
      invoiceCount: invoices.length,
      paymentIntentCount: paymentIntents.length,
      subscriptionCount: input.subscriptions.length,
      assumptions: operatingExpensesMinor > 0
        ? ["Burn rate is computed from supplied operating expenses minus collected cash."]
        : ["Burn rate is zeroed when no operatingExpensesMinor input is provided."],
    },
  };
}

export function createPostmortemReport(input: PostmortemInput) {
  const correctiveActions = input.correctiveActions?.filter((action) => action.trim()) ?? [];
  const summary = input.summary?.trim() || `${input.initiativeName} was cancelled on ${input.cancelledAt.slice(0, 10)}.`;
  const sections: ReportSection[] = [
    {
      title: sectionTitle(0, "What Happened", input.template),
      body: summary,
    },
    {
      title: sectionTitle(1, "Why It Ended", input.template),
      body: input.reason?.trim() || "A cancellation reason was not provided.",
    },
    {
      title: sectionTitle(2, "Impact", input.template),
      body: input.impact?.trim() || "Impact analysis is pending.",
    },
    {
      title: sectionTitle(3, "Corrective Actions", input.template),
      body: correctiveActions.length > 0 ? correctiveActions.map((action) => `- ${action}`).join("\n") : "- No corrective actions recorded yet.",
    },
  ];

  return {
    teamId: input.teamId,
    kind: "postmortem" as const,
    title: input.template?.headline?.trim() || `${input.initiativeName} postmortem`,
    summary,
    periodStart: input.cancelledAt,
    periodEnd: input.cancelledAt,
    template: input.template ?? {},
    sections,
    metrics: [
      metric("corrective_action_count", "Corrective actions", correctiveActions.length, "count"),
      metric("owner", "Owner", input.owner?.trim() || "unassigned", "text"),
    ],
    delivery: input.delivery ?? [],
    source: {
      initiativeName: input.initiativeName,
      cancelledAt: input.cancelledAt,
      owner: input.owner?.trim() || null,
    },
  };
}
