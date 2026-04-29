import { controlPlaneStore } from "../controlPlane/controlPlaneStore";
import { getTemplate } from "../templates";
import type { WorkflowRun, StepResult, WorkflowStep } from "../types/workflow";

export interface ToolAuditEntry {
  timestamp: string;
  toolType: string;
  toolName: string;
  serverUrl?: string;
  input: Record<string, unknown>;
  output: unknown;
}

export interface StepObservabilityMetadata {
  stepKind?: string;
  startedAt?: string;
  completedAt?: string;
  reasoningTrace?: string;
  toolCalls?: ToolAuditEntry[];
  agentExecution?: {
    executionId?: string;
    teamId?: string;
    agentId?: string;
    taskId?: string | null;
    skills?: string[];
  };
}

export interface ObservabilityRecord {
  id: string;
  runId: string;
  templateId: string;
  templateName: string;
  stepId: string;
  stepName: string;
  stepKind: string;
  status: StepResult["status"];
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  costUsd: number;
  reasoningTrace?: string;
  toolCalls: ToolAuditEntry[];
  agentId?: string;
  agentName?: string;
  taskId?: string;
  taskTitle?: string;
  executionId?: string;
}

export interface ObservabilityAggregate {
  id: string;
  name: string;
  totalCostUsd: number;
  traceCount: number;
}

export interface ObservabilityResponse {
  records: ObservabilityRecord[];
  total: number;
  filters: {
    agents: Array<{ id: string; name: string }>;
    tasks: Array<{ id: string; title: string }>;
  };
  aggregates: {
    totalCostUsd: number;
    perAgent: ObservabilityAggregate[];
    perTask: ObservabilityAggregate[];
  };
}

export interface ObservabilityQuery {
  workspaceId?: string;
  agentId?: string;
  taskId?: string;
  search?: string;
  from?: string;
  to?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractObservability(step: StepResult): StepObservabilityMetadata {
  const raw = step.output["_observability"];
  if (!isRecord(raw)) return {};

  return {
    stepKind: typeof raw["stepKind"] === "string" ? raw["stepKind"] : undefined,
    startedAt: typeof raw["startedAt"] === "string" ? raw["startedAt"] : undefined,
    completedAt: typeof raw["completedAt"] === "string" ? raw["completedAt"] : undefined,
    reasoningTrace: typeof raw["reasoningTrace"] === "string" ? raw["reasoningTrace"] : undefined,
    toolCalls: Array.isArray(raw["toolCalls"])
      ? raw["toolCalls"].filter(isRecord).map((entry) => ({
          timestamp: typeof entry["timestamp"] === "string" ? entry["timestamp"] : new Date().toISOString(),
          toolType: typeof entry["toolType"] === "string" ? entry["toolType"] : "tool",
          toolName: typeof entry["toolName"] === "string" ? entry["toolName"] : "unknown",
          serverUrl: typeof entry["serverUrl"] === "string" ? entry["serverUrl"] : undefined,
          input: isRecord(entry["input"]) ? entry["input"] : {},
          output: entry["output"],
        }))
      : [],
    agentExecution: isRecord(raw["agentExecution"])
      ? {
          executionId:
            typeof raw["agentExecution"]["executionId"] === "string"
              ? (raw["agentExecution"]["executionId"] as string)
              : undefined,
          teamId:
            typeof raw["agentExecution"]["teamId"] === "string"
              ? (raw["agentExecution"]["teamId"] as string)
              : undefined,
          agentId:
            typeof raw["agentExecution"]["agentId"] === "string"
              ? (raw["agentExecution"]["agentId"] as string)
              : undefined,
          taskId:
            typeof raw["agentExecution"]["taskId"] === "string"
              ? (raw["agentExecution"]["taskId"] as string)
              : raw["agentExecution"]["taskId"] === null
                ? null
                : undefined,
          skills: Array.isArray(raw["agentExecution"]["skills"])
            ? (raw["agentExecution"]["skills"] as unknown[]).filter(
                (skill): skill is string => typeof skill === "string"
              )
            : undefined,
        }
      : undefined,
  };
}

function resolveStepKind(step: StepResult, templateStep?: WorkflowStep): string {
  const metadata = extractObservability(step);
  return metadata.stepKind ?? templateStep?.kind ?? "step";
}

function matchesSearch(record: ObservabilityRecord, search?: string): boolean {
  if (!search) return true;
  const query = search.trim().toLowerCase();
  if (!query) return true;

  const haystack = [
    record.templateName,
    record.stepName,
    record.stepKind,
    record.agentName,
    record.taskTitle,
    record.reasoningTrace,
    ...record.toolCalls.map((call) => `${call.toolType} ${call.toolName}`),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLowerCase();

  return haystack.includes(query);
}

function withinRange(record: ObservabilityRecord, from?: string, to?: string): boolean {
  const ts = new Date(record.startedAt).getTime();
  if (Number.isNaN(ts)) return true;

  if (from) {
    const fromTs = new Date(from).getTime();
    if (!Number.isNaN(fromTs) && ts < fromTs) return false;
  }

  if (to) {
    const toTs = new Date(to).getTime();
    if (!Number.isNaN(toTs) && ts > toTs) return false;
  }

  return true;
}

function toCsv(records: ObservabilityRecord[]): string {
  const header = [
    "timestamp",
    "template",
    "step",
    "step_kind",
    "status",
    "agent",
    "task",
    "cost_usd",
    "tool_calls",
    "reasoning_trace",
  ];

  const escape = (value: unknown): string => {
    const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
    return `"${text.replace(/"/g, `""`)}"`;
  };

  const rows = records.map((record) =>
    [
      record.startedAt,
      record.templateName,
      record.stepName,
      record.stepKind,
      record.status,
      record.agentName ?? "",
      record.taskTitle ?? "",
      record.costUsd.toFixed(6),
      record.toolCalls.map((call) => `${call.toolType}:${call.toolName}`).join(" | "),
      record.reasoningTrace ?? "",
    ]
      .map(escape)
      .join(",")
  );

  return [header.join(","), ...rows].join("\n");
}

export function buildObservabilityResponse(
  userId: string,
  runs: WorkflowRun[],
  query: ObservabilityQuery
): ObservabilityResponse {
  const agents = controlPlaneStore.listAllAgents(userId, query.workspaceId);
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
  const tasks = controlPlaneStore.listTasks(userId);
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const executions = controlPlaneStore.listExecutions(userId, undefined, query.workspaceId);
  const executionByStep = new Map(
    executions.map((execution) => [`${execution.sourceRunId}:${execution.sourceWorkflowStepId}`, execution] as const)
  );

  const records = runs
    .flatMap((run) => {
      let templateSteps = new Map<string, WorkflowStep>();
      try {
        templateSteps = new Map(getTemplate(run.templateId).steps.map((step) => [step.id, step]));
      } catch {
        templateSteps = new Map();
      }

      return run.stepResults.map((step) => {
        const metadata = extractObservability(step);
        const execution =
          executionByStep.get(`${run.id}:${step.stepId}`) ??
          (metadata.agentExecution?.executionId
            ? executions.find((candidate) => candidate.id === metadata.agentExecution?.executionId)
            : undefined);
        const agentId = metadata.agentExecution?.agentId ?? execution?.agentId;
        const taskId = metadata.agentExecution?.taskId ?? execution?.taskId;
        const agent = agentId ? agentMap.get(agentId) : undefined;
        const task = taskId ? taskMap.get(taskId) : undefined;

        return {
          id: `${run.id}:${step.stepId}`,
          runId: run.id,
          templateId: run.templateId,
          templateName: run.templateName,
          stepId: step.stepId,
          stepName: step.stepName,
          stepKind: resolveStepKind(step, templateSteps.get(step.stepId)),
          status: step.status,
          startedAt: metadata.startedAt ?? run.startedAt,
          completedAt: metadata.completedAt ?? run.completedAt,
          durationMs: step.durationMs,
          costUsd:
            step.costLog?.estimatedCostUsd ??
            execution?.costUsd ??
            0,
          reasoningTrace: metadata.reasoningTrace,
          toolCalls: metadata.toolCalls ?? [],
          agentId,
          agentName: agent?.name,
          taskId: task?.id,
          taskTitle: task?.title,
          executionId: execution?.id ?? metadata.agentExecution?.executionId,
        } satisfies ObservabilityRecord;
      });
    })
    .filter((record) => !query.agentId || record.agentId === query.agentId)
    .filter((record) => !query.taskId || record.taskId === query.taskId)
    .filter((record) => withinRange(record, query.from, query.to))
    .filter((record) => matchesSearch(record, query.search))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));

  const aggregate = (
    items: ObservabilityRecord[],
    key: "agentId" | "taskId",
    label: "agentName" | "taskTitle"
  ): ObservabilityAggregate[] => {
    const buckets = new Map<string, ObservabilityAggregate>();
    for (const item of items) {
      const id = item[key];
      const name = item[label];
      if (!id || !name) continue;
      const current = buckets.get(id) ?? { id, name, totalCostUsd: 0, traceCount: 0 };
      current.totalCostUsd = Number((current.totalCostUsd + item.costUsd).toFixed(6));
      current.traceCount += 1;
      buckets.set(id, current);
    }
    return Array.from(buckets.values()).sort((left, right) => right.totalCostUsd - left.totalCostUsd);
  };

  return {
    records,
    total: records.length,
    filters: {
      agents: agents.map((agent) => ({ id: agent.id, name: agent.name })),
      tasks: tasks.map((task) => ({ id: task.id, title: task.title })),
    },
    aggregates: {
      totalCostUsd: Number(records.reduce((sum, record) => sum + record.costUsd, 0).toFixed(6)),
      perAgent: aggregate(records, "agentId", "agentName"),
      perTask: aggregate(records, "taskId", "taskTitle"),
    },
  };
}

export function buildObservabilityCsv(records: ObservabilityRecord[]): string {
  return toCsv(records);
}
