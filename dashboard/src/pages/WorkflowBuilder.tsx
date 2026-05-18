import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  Plus,
  Play,
  Trash2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  Zap,
  Brain,
  GitBranch,
  Wrench,
  ArrowRight,
  Flag,
  Save,
  X,
  Bot,
  UserCheck,
  Plug,
  FileInput,
  CalendarClock,
  Timer,
  Sparkles,
  Loader,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  CircleHelp,
  PanelRightOpen,
  PanelRightClose,
  Send,
} from "lucide-react";
import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type XYPosition,
} from "@xyflow/react";
import clsx from "clsx";
import {
  createTemplate,
  deployWorkflowAsTeam,
  generateWorkflow,
  getTemplate,
  listLLMConfigs,
  listRuns,
  listTemplates,
  startRun,
  startRunWithFile,
  type ControlPlaneAgent,
  type ControlPlaneDeployment,
  type LLMConfig,
  type TemplateSummary,
} from "../api/client";
import {
  createCanonicalWorkflow,
  createCanonicalWorkflowVersion,
  getCanonicalWorkflowVersion,
  listCanonicalWorkflowVersions,
  listCanonicalWorkflows,
  type CanonicalWorkflowVersionDetail,
  type CanonicalWorkflowVersionSummary,
} from "../api/workflowsApi";
import { Tooltip } from "../components/Tooltip";
import { ErrorState, LoadingState } from "../components/UiStates";
import type { WorkflowRun, WorkflowStep, StepKind, WorkflowTemplate } from "../types/workflow";
import {
  buildDefaultEdge,
  buildEdgesFromSteps,
  serializeEdgesToSteps,
  STEP_POSITION_KEY,
  validateEdgeCandidate,
  validateGraphTopology,
} from "./workflowGraph";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";

const KIND_META: Record<
  StepKind,
  {
    label: string;
    icon: React.ReactNode;
    chipColor: string;
    chipBg: string;
    categoryTint: string;
    darkCategoryTint: string;
    categoryBorder: string;
  }
> = {
  trigger: {
    label: "Trigger",
    icon: <Zap size={14} />,
    chipColor: "text-af2-mustard",
    chipBg: "bg-af2-mustard/10 border-af2-mustard/30",
    categoryTint: "rgba(249,115,22,0.12)",
    darkCategoryTint: "rgba(249,115,22,0.18)",
    categoryBorder: "#f97316",
  },
  cron_trigger: {
    label: "Cron Trigger",
    icon: <CalendarClock size={14} />,
    chipColor: "text-af2-sage",
    chipBg: "bg-af2-sage/10 border-af2-sage/30",
    categoryTint: "rgba(16,185,129,0.12)",
    darkCategoryTint: "rgba(16,185,129,0.18)",
    categoryBorder: "#10b981",
  },
  interval_trigger: {
    label: "Interval Trigger",
    icon: <Timer size={14} />,
    chipColor: "text-af2-sage",
    chipBg: "bg-af2-sage/10 border-af2-sage/30",
    categoryTint: "rgba(16,185,129,0.12)",
    darkCategoryTint: "rgba(16,185,129,0.18)",
    categoryBorder: "#10b981",
  },
  llm: {
    label: "LLM",
    icon: <Brain size={14} />,
    chipColor: "text-af2-clay",
    chipBg: "bg-af2-clay-soft/30 border-af2-clay/30",
    categoryTint: "rgba(99,102,241,0.12)",
    darkCategoryTint: "rgba(99,102,241,0.18)",
    categoryBorder: "#6366f1",
  },
  condition: {
    label: "Condition",
    icon: <GitBranch size={14} />,
    chipColor: "text-af2-mustard",
    chipBg: "bg-af2-mustard/10 border-af2-mustard/30",
    categoryTint: "rgba(245,158,11,0.12)",
    darkCategoryTint: "rgba(245,158,11,0.18)",
    categoryBorder: "#f59e0b",
  },
  transform: {
    label: "Transform",
    icon: <Wrench size={14} />,
    chipColor: "text-af2-clay",
    chipBg: "bg-af2-clay-soft/30 border-af2-clay/30",
    categoryTint: "rgba(99,102,241,0.12)",
    darkCategoryTint: "rgba(99,102,241,0.18)",
    categoryBorder: "#6366f1",
  },
  action: {
    label: "Action",
    icon: <ArrowRight size={14} />,
    chipColor: "text-af2-clay",
    chipBg: "bg-af2-clay-soft/30 border-af2-clay/30",
    categoryTint: "rgba(99,102,241,0.12)",
    darkCategoryTint: "rgba(99,102,241,0.18)",
    categoryBorder: "#6366f1",
  },
  output: {
    label: "Output",
    icon: <Flag size={14} />,
    chipColor: "text-af2-clay",
    chipBg: "bg-af2-clay-soft/30 border-af2-clay/30",
    categoryTint: "rgba(99,102,241,0.12)",
    darkCategoryTint: "rgba(99,102,241,0.18)",
    categoryBorder: "#6366f1",
  },
  agent: {
    label: "Agent",
    icon: <Bot size={14} />,
    chipColor: "text-af2-clay",
    chipBg: "bg-af2-clay-soft/30 border-af2-clay/30",
    categoryTint: "rgba(99,102,241,0.12)",
    darkCategoryTint: "rgba(99,102,241,0.18)",
    categoryBorder: "#6366f1",
  },
  approval: {
    label: "Approval",
    icon: <UserCheck size={14} />,
    chipColor: "text-af2-clay",
    chipBg: "bg-af2-clay-soft/30 border-af2-clay/30",
    categoryTint: "rgba(99,102,241,0.12)",
    darkCategoryTint: "rgba(99,102,241,0.18)",
    categoryBorder: "#6366f1",
  },
  mcp: {
    label: "Integration",
    icon: <Plug size={14} />,
    chipColor: "text-af2-ink-blue",
    chipBg: "bg-af2-ink-blue/10 border-af2-ink-blue/30",
    categoryTint: "rgba(14,165,233,0.12)",
    darkCategoryTint: "rgba(14,165,233,0.18)",
    categoryBorder: "#0ea5e9",
  },
  file_trigger: {
    label: "File Trigger",
    icon: <FileInput size={14} />,
    chipColor: "text-af2-mustard",
    chipBg: "bg-af2-mustard/10 border-af2-mustard/30",
    categoryTint: "rgba(249,115,22,0.12)",
    darkCategoryTint: "rgba(249,115,22,0.18)",
    categoryBorder: "#f97316",
  },
};

type NodeVisualState = "idle" | "running" | "success" | "error";

function readNodeVisualState(step: WorkflowStep): NodeVisualState {
  const state = step.config?.__uiState;
  if (state === "running" || state === "success" || state === "error") {
    return state;
  }
  return "idle";
}

const BLANK_TEMPLATE: WorkflowTemplate = {
  id: "tpl-custom-" + Date.now(),
  name: "Untitled Workflow",
  description: "",
  category: "custom",
  version: "1.0.0",
  configFields: [],
  steps: [],
  sampleInput: {},
  expectedOutput: {},
};

type BuilderLocationState = {
  copilotPrompt?: string;
} | null;

type CopilotProposalMode = "replace" | "append" | "insert_after";

type CopilotProposal = {
  mode: CopilotProposalMode;
  title: string;
  summary: string;
  steps: WorkflowStep[];
  targetStepId?: string;
};

type CopilotMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposal?: CopilotProposal;
};

const FLOW_STEP_X = 80;
const FLOW_STEP_Y = 64;
const FLOW_STEP_GAP_Y = 190;
const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Toronto",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

function getTimezoneOptions(): string[] {
  const supportedValuesOf = (Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  }).supportedValuesOf;

  if (typeof supportedValuesOf === "function") {
    const supported = supportedValuesOf("timeZone");
    return Array.from(new Set([...COMMON_TIMEZONES, ...supported]));
  }
  return [...COMMON_TIMEZONES];
}

function validateCronExpression(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Invalid cron expression. Please check the syntax.";

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return "Invalid cron expression. Please check the syntax.";
  }

  const validField = /^(\*|\?|[\d*/,\-A-Z]+)$/i;
  if (fields.some((field) => !validField.test(field))) {
    return "Invalid cron expression. Please check the syntax.";
  }

  return null;
}

function validateIntervalMinutes(value: number | undefined): string | null {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    return "Interval must be a positive integer.";
  }
  return null;
}

function formatTime(hour: number, minute: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 0, 5, hour, minute))) + ` ${timezone}`;
}

function describeCronExpression(cronExpression: string, timezone: string): string | null {
  if (validateCronExpression(cronExpression)) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronExpression.trim().split(/\s+/);
  const dayNames: Record<string, string> = {
    "0": "Sunday",
    "1": "Monday",
    "2": "Tuesday",
    "3": "Wednesday",
    "4": "Thursday",
    "5": "Friday",
    "6": "Saturday",
    "7": "Sunday",
  };

  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Runs every minute (${timezone})`;
  }

  if (/^\d+$/.test(minute) && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Runs every hour at minute ${minute.padStart(2, "0")} (${timezone})`;
  }

  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return `Runs every day at ${formatTime(Number(hour), Number(minute), timezone)}`;
  }

  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek in dayNames
  ) {
    return `Runs every ${dayNames[dayOfWeek]} at ${formatTime(Number(hour), Number(minute), timezone)}`;
  }

  return `Runs on schedule ${cronExpression} (${timezone})`;
}

function buildStepFieldClass(options?: { mono?: boolean; hasError?: boolean; flashSuccess?: boolean }) {
  return clsx(
    "w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 bg-af2-card text-af2-ink",
    options?.mono && "font-mono",
    options?.hasError
      ? "border-af2-clay focus:ring-af2-clay/30"
      : options?.flashSuccess
        ? "border-af2-sage focus:ring-af2-clay/30 ring-2 ring-emerald-500/20"
        : "border-af2-line-2 focus:ring-af2-clay/30",
  );
}

function buildDefaultStep(kind: StepKind, id: string, position: XYPosition): WorkflowStep {
  const step: WorkflowStep = {
    id,
    name: KIND_META[kind].label + " Step",
    kind,
    description: "",
    inputKeys: [],
    outputKeys: [],
    config: {
      [STEP_POSITION_KEY]: position,
    },
  };

  if (kind === "cron_trigger") {
    step.timezone = "UTC";
  }

  if (kind === "interval_trigger") {
    step.intervalMinutes = 15;
    step.timezone = "UTC";
  }

  return step;
}

type FlowNodeData = {
  step: WorkflowStep;
  onSelect: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onRemove: (id: string) => void;
  isFirst: boolean;
  isLast: boolean;
  teamAgent?: ControlPlaneAgent;
  teamAgentHref?: string;
};

type WorkflowFlowNode = Node<FlowNodeData>;

function readStepPosition(step: WorkflowStep, index: number): XYPosition {
  const candidate = step.config?.[STEP_POSITION_KEY];
  if (
    candidate &&
    typeof candidate === "object" &&
    "x" in candidate &&
    "y" in candidate &&
    typeof candidate.x === "number" &&
    typeof candidate.y === "number"
  ) {
    return { x: candidate.x, y: candidate.y };
  }

  return {
    x: FLOW_STEP_X,
    y: FLOW_STEP_Y + index * FLOW_STEP_GAP_Y,
  };
}

export default function WorkflowBuilder() {
  const { templateId } = useParams<{ templateId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { requireAccessToken, getAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const incomingState = location.state as BuilderLocationState;
  // HEL-100: builder pop-out (?popout=1) hides every piece of chrome —
  // Layout.tsx skips its sidebar+topbar, and we skip the left palette
  // rail too so the canvas can go full-bleed.
  const isBuilderPopout = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("popout") === "1";
  }, [location.search]);

  const [template, setTemplate] = useState<WorkflowTemplate>(BLANK_TEMPLATE);
  const [loading, setLoading] = useState(!!templateId);
  const [allTemplates, setAllTemplates] = useState<TemplateSummary[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>([]);
  const [llmConfigsLoading, setLlmConfigsLoading] = useState(false);
  const [llmConfigsError, setLlmConfigsError] = useState<string | null>(null);
  const [showNLModal, setShowNLModal] = useState(false);
  const [showFileUploadModal, setShowFileUploadModal] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showCopilot, setShowCopilot] = useState(Boolean(incomingState?.copilotPrompt));
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [latestDeployment, setLatestDeployment] = useState<ControlPlaneDeployment | null>(null);
  const [copilotInput, setCopilotInput] = useState(incomingState?.copilotPrompt ?? "");
  const [copilotMessages, setCopilotMessages] = useState<CopilotMessage[]>([]);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotModel, setCopilotModel] = useState("Auto");
  const [copilotLiveMessage, setCopilotLiveMessage] = useState("");
  const [consumedIncomingPrompt, setConsumedIncomingPrompt] = useState(false);
  const [fieldFlashKey, setFieldFlashKey] = useState<string | null>(null);
  // HEL-27: Pro mode reveals the env panel + advanced inspector. The toggle
  // lives next to Save/Run in the header; the panel renders alongside the
  // existing inspector when on.
  const [proMode, setProMode] = useState(false);
  // HEL-100 v2: when proMode is on, the right rail switches between three
  // panels (Inspector / Versions / Observability) per AF2_Studio. The
  // default tab is "inspector" which shows the existing step-detail form.
  const [proInspectorTab, setProInspectorTab] = useState<
    "inspector" | "versions" | "observability"
  >("inspector");
  // HEL-100 v2: last-30 runs for the canvas-bottom history strip. Empty
  // until the template has been saved at least once (no templateId =
  // no runs to fetch); on a successful fetch we keep only the most
  // recent 30 by startedAt DESC.
  const [runHistory, setRunHistory] = useState<WorkflowRun[]>([]);
  // HEL-100 v2 Pro Versions tab: immutable workflow_versions list for
  // canonicalWorkflowId, newest first. Empty until the workflow has
  // been canonicalized (first save). Diff + restore wiring is a
  // follow-up — this PR ships the list.
  const [workflowVersions, setWorkflowVersions] = useState<
    CanonicalWorkflowVersionSummary[]
  >([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  // HEL-100 v2 diff modal state: which version the user is comparing
  // against the current latest. Null = modal closed.
  const [diffTargetVersionId, setDiffTargetVersionId] = useState<string | null>(
    null,
  );
  // HEL-100 v2 restore flow: tracks which version id is being restored
  // so the row can show a spinner + disable other restore buttons
  // during the POST.
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(
    null,
  );
  const [versionsActionError, setVersionsActionError] = useState<string | null>(
    null,
  );
  // HEL-27: canonical workflow_id for this template. Set on first save
  // when the canonical /api/workflows POST returns; subsequent saves call
  // POST /api/workflows/:id/versions to create immutable versions.
  const [canonicalWorkflowId, setCanonicalWorkflowId] = useState<string | null>(null);

  const hasFileTrigger = template.steps.some((s) => s.kind === "file_trigger");
  const fileTriggerStep = template.steps.find((s) => s.kind === "file_trigger");
  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);

  useEffect(() => {
    listTemplates()
      .then(setAllTemplates)
      .catch((e) => setTemplatesError(e instanceof Error ? e.message : "Failed to load templates"));
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!templateId) return;
    setLoading(true);
    setTemplateLoadError(null);
    getTemplate(templateId)
      .then(setTemplate)
      .catch((e) => {
        setTemplateLoadError(
          e instanceof Error ? e.message : "Failed to load selected template"
        );
      })
      .finally(() => setLoading(false));
  }, [activeWorkspaceId, templateId]);

  // HEL-100 v2 follow-up: resolve the canonical workflow_id for a
  // loaded legacy template so the Versions panel can surface for
  // templates the user opens without re-saving. canonicalWorkflowId
  // gets set on first save in the dual-write path, but a freshly
  // loaded template starts at null — meaning the Versions tab would
  // stay in its "Save to start version history" state even though the
  // canonical workflow exists. listCanonicalWorkflows with the
  // ?externalTemplateId filter finds the match; silent on failure
  // since the panel falls back to the draft state cleanly.
  useEffect(() => {
    if (!templateId) {
      return;
    }
    let cancelled = false;
    async function resolveCanonicalWorkflow() {
      try {
        const accessToken = await requireAccessToken();
        const workflows = await listCanonicalWorkflows(accessToken, {
          externalTemplateId: templateId,
        });
        if (cancelled) return;
        if (workflows.length > 0 && workflows[0]) {
          setCanonicalWorkflowId(workflows[0].id);
        }
      } catch {
        // Silent: Versions panel just stays in draft state if the
        // lookup fails. The save path can still canonicalize later.
      }
    }
    void resolveCanonicalWorkflow();
    return () => {
      cancelled = true;
    };
  }, [templateId, requireAccessToken]);

  const selectedStep = template.steps.find((s) => s.id === selectedStepId) ?? null;
  const isLlmStep = selectedStep?.kind === "llm";
  const deploymentAgentByStepId = useMemo(() => {
    const mapping = new Map<string, ControlPlaneAgent>();
    if (!latestDeployment) return mapping;
    for (const agent of latestDeployment.agents) {
      if (agent.workflowStepId && !mapping.has(agent.workflowStepId)) {
        mapping.set(agent.workflowStepId, agent);
      }
    }
    return mapping;
  }, [latestDeployment]);
  const cronValidationError =
    selectedStep?.kind === "cron_trigger"
      ? validateCronExpression(selectedStep.cronExpression ?? "")
      : null;
  const intervalValidationError =
    selectedStep?.kind === "interval_trigger"
      ? validateIntervalMinutes(selectedStep.intervalMinutes)
      : null;
  const cronPreview =
    selectedStep?.kind === "cron_trigger"
      ? describeCronExpression(selectedStep.cronExpression ?? "", selectedStep.timezone ?? "UTC")
      : null;
  const cronFlashKey = selectedStep ? `cron:${selectedStep.id}` : null;
  const intervalFlashKey = selectedStep ? `interval:${selectedStep.id}` : null;

  useEffect(() => {
    if (!fieldFlashKey) return;
    const timeout = window.setTimeout(() => setFieldFlashKey(null), 900);
    return () => window.clearTimeout(timeout);
  }, [fieldFlashKey]);

  // HEL-100 v2: fetch the most-recent runs for this template to feed the
  // canvas-bottom run-history strip. Skipped for unsaved drafts (no
  // templateId); fired again when the templateId loads from the URL.
  // Failures (incl. no-token) are silent — the strip simply doesn't
  // render — because the sparkline is decorative, not load-bearing.
  // Uses requireAccessToken via a stable closure rather than
  // getAccessToken as a dep, because some useAuth implementations return
  // a fresh getAccessToken on every render (the test mock does) which
  // would re-fire this effect infinitely.
  useEffect(() => {
    if (!templateId) {
      setRunHistory([]);
      return;
    }
    let cancelled = false;
    async function loadRunHistory() {
      try {
        const accessToken = await requireAccessToken();
        const runs = await listRuns(templateId, accessToken);
        if (cancelled) return;
        // Sort startedAt DESC; keep the most recent 30 so the sparkline
        // matches the AF2_Studio reference's "Last 30 runs" strap.
        const sorted = [...runs].sort((a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
        );
        setRunHistory(sorted.slice(0, 30));
      } catch {
        if (!cancelled) setRunHistory([]);
      }
    }
    void loadRunHistory();
    return () => {
      cancelled = true;
    };
  }, [templateId, requireAccessToken]);

  // HEL-100 v2: fetch the canonical workflow_versions list when the Pro
  // Versions tab opens. Skipped for drafts (no canonicalWorkflowId)
  // and when the user isn't on the Versions tab. Re-fetches on tab
  // re-open and after a save (canonicalWorkflowId changes once per
  // first save, but the latest workflow_versions row gets appended on
  // every subsequent save — we re-trigger via proInspectorTab so the
  // panel reflects the newest list whenever the user comes back to
  // it).
  useEffect(() => {
    if (!proMode || proInspectorTab !== "versions" || !canonicalWorkflowId) {
      return;
    }
    let cancelled = false;
    setVersionsLoading(true);
    setVersionsError(null);
    async function loadVersions() {
      try {
        const accessToken = await requireAccessToken();
        const versions = await listCanonicalWorkflowVersions(
          canonicalWorkflowId!,
          accessToken,
        );
        if (!cancelled) {
          setWorkflowVersions(versions);
        }
      } catch (err) {
        if (!cancelled) {
          setVersionsError(
            err instanceof Error ? err.message : "Failed to load versions",
          );
        }
      } finally {
        if (!cancelled) setVersionsLoading(false);
      }
    }
    void loadVersions();
    return () => {
      cancelled = true;
    };
  }, [proMode, proInspectorTab, canonicalWorkflowId, requireAccessToken]);

  // HEL-100 v2 Versions panel actions: refresh the list (used after a
  // successful restore so the new version row appears + the "current"
  // pill flips to it).
  const refreshVersions = useCallback(async () => {
    if (!canonicalWorkflowId) return;
    try {
      const accessToken = await requireAccessToken();
      const versions = await listCanonicalWorkflowVersions(
        canonicalWorkflowId,
        accessToken,
      );
      setWorkflowVersions(versions);
    } catch (err) {
      setVersionsError(
        err instanceof Error ? err.message : "Failed to refresh versions",
      );
    }
  }, [canonicalWorkflowId, requireAccessToken]);

  // HEL-100 v2 restore semantics: fetch the chosen version's dag, then
  // POST it as a brand-new workflow_versions row. History is never
  // destroyed — the older version stays in place; the restored copy
  // becomes the new latest. After success, refresh the list so the
  // "current" pill flips to the new row AND apply the restored dag
  // to the in-editor template state so the canvas reflects the
  // restored steps (closing #795's deferred "reload-editor-after-
  // restore" follow-up).
  const handleRestoreVersion = useCallback(
    async (versionId: string) => {
      if (!canonicalWorkflowId) return;
      setVersionsActionError(null);
      setRestoringVersionId(versionId);
      try {
        const accessToken = await requireAccessToken();
        const detail = await getCanonicalWorkflowVersion(
          canonicalWorkflowId,
          versionId,
          accessToken,
        );
        await createCanonicalWorkflowVersion(
          canonicalWorkflowId,
          detail.dag,
          accessToken,
        );
        // Apply the restored dag to the in-editor template state. We
        // keep template.id pinned to the active legacy template ID
        // (the dag's own id is the same value across versions, but
        // belt + suspenders against weird older dags), and we clear
        // selectedStepId if the restored steps no longer contain it
        // (otherwise the inspector would point at a phantom).
        setTemplate((current) => {
          const restored = applyDagToTemplate(current, detail.dag);
          return restored;
        });
        setSelectedStepId((currentSelectedId) => {
          if (!currentSelectedId) return currentSelectedId;
          const stepsAny = (detail.dag as { steps?: unknown }).steps;
          const stillExists =
            Array.isArray(stepsAny) &&
            stepsAny.some(
              (s) =>
                typeof s === "object" &&
                s !== null &&
                (s as { id?: unknown }).id === currentSelectedId,
            );
          return stillExists ? currentSelectedId : null;
        });
        await refreshVersions();
      } catch (err) {
        setVersionsActionError(
          err instanceof Error ? err.message : "Failed to restore version",
        );
      } finally {
        setRestoringVersionId(null);
      }
    },
    [canonicalWorkflowId, refreshVersions, requireAccessToken],
  );

  useEffect(() => {
    if (!isLlmStep) return;
    let cancelled = false;
    async function loadLlmConfigs() {
      setLlmConfigsLoading(true);
      setLlmConfigsError(null);
      try {
        const accessToken = await requireAccessToken();
        const configs = await listLLMConfigs(accessToken);
        if (!cancelled) setLlmConfigs(configs);
      } catch (e) {
        if (!cancelled) {
          setLlmConfigsError(e instanceof Error ? e.message : "Failed to load providers");
        }
      } finally {
        if (!cancelled) setLlmConfigsLoading(false);
      }
    }
    void loadLlmConfigs();
    return () => {
      cancelled = true;
    };
  }, [isLlmStep, requireAccessToken]);

  const handleCopilotSubmit = useCallback(async (rawPrompt?: string) => {
    const prompt = (rawPrompt ?? copilotInput).trim();
    if (!prompt || copilotBusy) return;

    setShowCopilot(true);
    setCopilotBusy(true);
    setCopilotLiveMessage("AutoFlow Copilot is generating a response.");
    setCopilotMessages((messages) => [
      ...messages,
      { id: `user-${Date.now()}`, role: "user", content: prompt },
    ]);
    setCopilotInput("");

    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const response = await buildCopilotResponse(prompt, template, selectedStepId, accessToken);
      setCopilotMessages((messages) => [
        ...messages,
        { id: `assistant-${Date.now()}`, role: "assistant", ...response },
      ]);
      setCopilotLiveMessage(response.content);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "AutoFlow Copilot could not process that request.";
      setCopilotMessages((messages) => [
        ...messages,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: message,
        },
      ]);
      setCopilotLiveMessage(message);
    } finally {
      setCopilotBusy(false);
    }
  }, [copilotBusy, copilotInput, getAccessToken, selectedStepId, template]);

  function handleApplyCopilotProposal(messageId: string, proposal: CopilotProposal) {
    setTemplate((currentTemplate) => applyCopilotProposal(currentTemplate, proposal));
    setCopilotMessages((messages) =>
      messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              proposal: undefined,
              content: `${message.content} Applied to the canvas.`,
            }
          : message
      )
    );
    setCopilotLiveMessage("Copilot proposal applied to the canvas.");
  }

  function handleRejectCopilotProposal(messageId: string) {
    setCopilotMessages((messages) =>
      messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              proposal: undefined,
              content: `${message.content} Proposal rejected.`,
            }
          : message
      )
    );
    setCopilotLiveMessage("Copilot proposal rejected.");
  }

  useEffect(() => {
    const incomingPrompt = incomingState?.copilotPrompt?.trim();
    if (!incomingPrompt || consumedIncomingPrompt) return;

    setConsumedIncomingPrompt(true);
    setShowCopilot(true);
    setCopilotInput(incomingPrompt);
    void handleCopilotSubmit(incomingPrompt);
    navigate(location.pathname, { replace: true, state: null });
  }, [incomingState, consumedIncomingPrompt, handleCopilotSubmit, navigate, location.pathname]);

  const copilotReferences = useMemo(() => {
    if (!copilotInput.includes("@")) return [];

    return template.steps.map((step, index) => ({
      id: step.id,
      label: `@Step ${index + 1} · ${step.name}`,
    }));
  }, [copilotInput, template.steps]);

  function addStep(kind: StepKind) {
    const newStepId = "step-" + Date.now();
    let autoLinkError: string | null = null;
    setTemplate((t) => {
      const nextIndex = t.steps.length;
      const defaultPosition = {
        x: FLOW_STEP_X,
        y: FLOW_STEP_Y + nextIndex * FLOW_STEP_GAP_Y,
      };
      const newStep = buildDefaultStep(kind, newStepId, defaultPosition);
      const nextSteps = [...t.steps, newStep];
      if (nextSteps.length < 2) {
        return { ...t, steps: nextSteps };
      }

      const existingEdges = buildEdgesFromSteps(t.steps);
      const previousStepId = nextSteps[nextSteps.length - 2].id;
      const alreadyLinked = existingEdges.some(
        (edge) => edge.source === previousStepId && edge.target === newStepId,
      );
      if (alreadyLinked) {
        return { ...t, steps: serializeEdgesToSteps(nextSteps, existingEdges) };
      }

      const validation = validateEdgeCandidate({
        sourceId: previousStepId,
        targetId: newStepId,
        steps: nextSteps,
        edges: existingEdges,
      });

      if (!validation.valid) {
        autoLinkError = validation.reason;
        return { ...t, steps: nextSteps };
      }

      const nextEdges = [...existingEdges, buildDefaultEdge(previousStepId, newStepId)];

      return { ...t, steps: serializeEdgesToSteps(nextSteps, nextEdges) };
    });
    setSelectedStepId(newStepId);
    setGraphError(autoLinkError);
  }

  function updateStep(id: string, patch: Partial<WorkflowStep>) {
    setTemplate((t) => ({
      ...t,
      steps: t.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }

  function flashField(key: string) {
    setFieldFlashKey(key);
  }

  function removeStep(id: string) {
    setTemplate((t) => {
      const nextSteps = t.steps.filter((s) => s.id !== id);
      const nextEdges = buildEdgesFromSteps(t.steps).filter(
        (edge) => edge.source !== id && edge.target !== id,
      );
      return { ...t, steps: serializeEdgesToSteps(nextSteps, nextEdges) };
    });
    if (selectedStepId === id) setSelectedStepId(null);
    setGraphError(null);
  }

  function updateStepPosition(id: string, position: XYPosition) {
    setTemplate((t) => ({
      ...t,
      steps: t.steps.map((s) =>
        s.id === id
          ? {
              ...s,
              config: {
                ...(s.config ?? {}),
                [STEP_POSITION_KEY]: {
                  x: Math.round(position.x),
                  y: Math.round(position.y),
                },
              },
            }
          : s
      ),
    }));
  }

  function moveStep(id: string, dir: -1 | 1) {
    const idx = template.steps.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const next = idx + dir;
    if (next < 0 || next >= template.steps.length) return;
    const arr = [...template.steps];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    setTemplate((t) => ({ ...t, steps: arr }));
  }

  const flowNodes: WorkflowFlowNode[] = template.steps.map((step, idx) => {
    const teamAgent = deploymentAgentByStepId.get(step.id);
    const teamAgentHref =
      latestDeployment && teamAgent
        ? `/agents/team/${latestDeployment.team.id}?agent=${encodeURIComponent(teamAgent.id)}`
        : undefined;

    return {
      id: step.id,
      type: "workflowStep",
      position: readStepPosition(step, idx),
      draggable: true,
      selectable: true,
      data: {
        step,
        onSelect: setSelectedStepId,
        onMoveUp: (stepId: string) => moveStep(stepId, -1),
        onMoveDown: (stepId: string) => moveStep(stepId, 1),
        onRemove: removeStep,
        isFirst: idx === 0,
        isLast: idx === template.steps.length - 1,
        teamAgent,
        teamAgentHref,
      },
    };
  });

  const flowEdges = useMemo(() => {
    const edges = buildEdgesFromSteps(template.steps);
    const stepsById = new Map(template.steps.map((step) => [step.id, step]));

    return edges.map((edge) => {
      const sourceStep = stepsById.get(edge.source);
      const sourceState = sourceStep ? readNodeVisualState(sourceStep) : "idle";
      const edgeClass =
        sourceState === "running"
          ? "workflow-edge workflow-edge-running"
          : "workflow-edge";

      return {
        ...edge,
        className: edgeClass,
        animated: sourceState === "running",
      };
    });
  }, [template.steps]);

  const nodeTypes = useMemo(
    () =>
      ({
        workflowStep: WorkflowStepNode,
      }) satisfies NodeTypes,
    []
  );

  function persistEdges(nextEdges: Edge[]) {
    setTemplate((t) => ({
      ...t,
      steps: serializeEdgesToSteps(t.steps, nextEdges),
    }));
  }

  function handleConnect(connection: Connection) {
    const sourceId = connection.source;
    const targetId = connection.target;
    if (!sourceId || !targetId) return;

    const validation = validateEdgeCandidate({
      sourceId,
      targetId,
      steps: template.steps,
      edges: flowEdges,
    });

    if (!validation.valid) {
      setGraphError(validation.reason);
      return;
    }

    setGraphError(null);
    persistEdges([...flowEdges, buildDefaultEdge(sourceId, targetId)]);
  }

  async function handleSave() {
    const topologyError = validateGraphTopology(template.steps, flowEdges);
    if (topologyError) {
      setGraphError(topologyError);
      return;
    }

    setGraphError(null);
    setSaveError(null);
    setSaving(true);
    setSaved(false);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const nextTemplate = await createTemplate({
        ...template,
        name: template.name.trim() || "Untitled Workflow",
        description: template.description ?? "",
        version: template.version || "1.0.0",
        category: template.category || "custom",
        configFields: template.configFields ?? [],
        steps: template.steps ?? [],
        sampleInput: template.sampleInput ?? {},
        expectedOutput: template.expectedOutput ?? {},
      }, accessToken);
      setTemplate(nextTemplate);

      // HEL-27: dual-write to the canonical workflows + workflow_versions
      // store. Non-blocking: if the canonical write fails (e.g. backend not
      // upgraded), the legacy template save above already succeeded so the
      // user-facing flow is intact. The error is logged for diagnosis.
      if (accessToken) {
        try {
          const dag = {
            name: nextTemplate.name,
            description: nextTemplate.description ?? "",
            version: nextTemplate.version ?? "1.0.0",
            category: nextTemplate.category ?? "custom",
            configFields: nextTemplate.configFields ?? [],
            steps: nextTemplate.steps ?? [],
            sampleInput: nextTemplate.sampleInput ?? {},
            expectedOutput: nextTemplate.expectedOutput ?? {},
          };
          if (canonicalWorkflowId) {
            // Subsequent edit: create an immutable new version.
            await createCanonicalWorkflowVersion(canonicalWorkflowId, dag, accessToken);
          } else {
            // First save: create the canonical workflow + v1.
            const created = await createCanonicalWorkflow(
              {
                name: nextTemplate.name,
                dag,
                externalTemplateId: nextTemplate.id,
              },
              accessToken,
            );
            setCanonicalWorkflowId(created.id);
          }
        } catch (canonicalErr) {
          console.warn(
            "[builder] canonical workflow write failed:",
            canonicalErr instanceof Error ? canonicalErr.message : canonicalErr,
          );
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      navigate(`/builder/${nextTemplate.id}`, { replace: true });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save workflow");
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    const topologyError = validateGraphTopology(template.steps, flowEdges);
    if (topologyError) {
      setGraphError(topologyError);
      return;
    }

    setGraphError(null);
    if (hasFileTrigger) {
      setShowFileUploadModal(true);
      return;
    }
    setRunError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      await startRun(template.id, template.sampleInput, undefined, accessToken);
      navigate("/monitor");
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Failed to start run");
    }
  }

  async function handleDeployTeam(input: {
    teamName: string;
    budgetMonthlyUsd?: number;
    defaultIntervalMinutes?: number;
  }) {
    setDeployBusy(true);
    setDeployError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const deployment = await deployWorkflowAsTeam(
        {
          templateId: template.id,
          teamName: input.teamName.trim() || undefined,
          budgetMonthlyUsd: input.budgetMonthlyUsd,
          defaultIntervalMinutes: input.defaultIntervalMinutes,
        },
        accessToken
      );
      setLatestDeployment(deployment);
      setShowDeployModal(false);
    } catch (error) {
      setDeployError(
        error instanceof Error ? error.message : "Failed to deploy workflow as an agent team"
      );
    } finally {
      setDeployBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Loading workflow template..." />
      </div>
    );
  }

  if (templateLoadError) {
    return (
      <div className="p-8">
        <ErrorState
          title="Template unavailable"
          message={templateLoadError}
          onRetry={() => navigate("/builder")}
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full">
      {/* HEL-100 v2: left palette rail — Triggers / Tools / Logic
          sections, mirrors docs/design/v2/studio.jsx::AF2_Studio. Clicking
          an item adds that step kind via the same `addStep` handler the
          inline AddStepMenu uses. Hidden in builder pop-out (?popout=1)
          so the canvas can go full-bleed. */}
      {!isBuilderPopout && <StudioPalette onAdd={addStep} />}

      {/* Left panel — canvas */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {runError && (
          <div className="px-6 py-2 bg-af2-clay-soft/30 border-b border-af2-clay/30 text-sm text-af2-clay">
            {runError}
          </div>
        )}
        {templatesError && (
          <div className="px-6 py-2 bg-af2-mustard/10 border-b border-af2-mustard/30 text-sm text-af2-mustard">
            {templatesError}
          </div>
        )}
        {saveError && (
          <div className="px-6 py-2 bg-af2-clay-soft/30 border-b border-af2-clay/30 text-sm text-af2-clay">
            {saveError}
          </div>
        )}
        {deployError && (
          <div className="px-6 py-2 bg-af2-clay-soft/30 border-b border-af2-clay/30 text-sm text-af2-clay">
            {deployError}
          </div>
        )}
        {latestDeployment && (
          <div className="flex items-center justify-between gap-3 px-6 py-3 bg-af2-sage/10 border-b border-af2-sage/30 text-sm text-af2-sage">
            <div>
              Deployed as <span className="font-semibold">{latestDeployment.team.name}</span> with{" "}
              <span className="font-semibold">{latestDeployment.agents.length}</span> agents.
            </div>
            <a
              href={`/agents/team/${latestDeployment.team.id}`}
              className="rounded-full bg-af2-sage px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-af2-sage-2"
            >
              Open team monitor
            </a>
          </div>
        )}
        {graphError && (
          <div className="px-6 py-2 bg-af2-mustard/10 border-b border-af2-mustard/30 text-sm text-af2-mustard">
            {graphError}
          </div>
        )}
        {/* Header — HEL-100 v2 restyle: editorial chrome over the canvas.
            af2-page wrapper isn't used here because Studio is a full-bleed
            canvas tool; the top bar still adopts af2 button styles + eyebrow
            for the v2 visual language. Deep restyles (palette, inspector,
            modals, copilot panel) tracked separately as HEL-100b/c. */}
        <div
          className="flex items-center justify-between px-6 py-3"
          style={{
            background: "var(--af2-paper)",
            borderBottom: "1px solid var(--af2-line)",
          }}
        >
          <div className="flex items-center gap-3">
            <div>
              <div className="af2-eyebrow">Build · Studio</div>
              <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                <input
                  className="af2-serif"
                  value={template.name}
                  onChange={(e) => setTemplate((t) => ({ ...t, name: e.target.value }))}
                  style={{
                    fontSize: 20,
                    fontWeight: 500,
                    letterSpacing: "-0.015em",
                    color: "var(--af2-ink)",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    padding: "2px 4px",
                    margin: "0 -4px",
                    minWidth: 240,
                  }}
                  aria-label="Workflow name"
                />
                <span className="af2-pill" style={{ textTransform: "capitalize" }}>
                  {template.category}
                </span>
                {/* HEL-100 v2: deployment/version pill — mirrors the
                    `live · v12` badge in docs/design/v2/studio.jsx. Shows
                    "live · v{version}" when a team is deployed for this
                    workflow, otherwise a quiet "draft · v{version}" pill. */}
                {latestDeployment ? (
                  <span className="af2-pill af2-pill-live" aria-label="Workflow status">
                    <span className="af2-dot" />
                    live · v{template.version || "1.0.0"}
                  </span>
                ) : (
                  <span className="af2-pill" aria-label="Workflow status">
                    <span className="af2-dot" />
                    draft · v{template.version || "1.0.0"}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* HEL-27: Pro mode toggle. Reveals env panel + advanced
                inspector when on. State only — sub-panels read `proMode`
                to decide whether to render. v2 pill styling (HEL-100)
                mirrors docs/design/v2/studio.jsx::AF2_Studio. */}
            <Tooltip content="Pro mode reveals the env panel and advanced inspector controls">
              <button
                type="button"
                onClick={() => setProMode((prev) => !prev)}
                aria-pressed={proMode}
                aria-label={proMode ? "Disable Pro mode" : "Enable Pro mode"}
                className="inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-medium transition"
                style={{
                  background: proMode ? "var(--af2-clay)" : "rgba(26,20,16,0.06)",
                  color: proMode ? "#fff" : "var(--af2-ink-2)",
                  borderColor: proMode ? "var(--af2-clay)" : "var(--af2-line-2)",
                }}
              >
                <span
                  className="grid h-[22px] w-[22px] place-items-center rounded-full text-[11px] font-bold"
                  style={{
                    background: proMode ? "#fff" : "var(--af2-card)",
                    color: proMode ? "var(--af2-clay)" : "var(--af2-ink)",
                  }}
                  aria-hidden="true"
                >
                  P
                </span>
                Pro mode {proMode ? "ON" : "OFF"}
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={() => setShowCopilot((open) => !open)}
              className="af2-btn af2-btn-sm"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {showCopilot ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
              Copilot
            </button>
            <Tooltip content="Open setup guidance and best practices for this page">
              <button
                type="button"
                onClick={() => setShowHelp(true)}
                className="af2-btn af2-btn-sm af2-btn-ghost"
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <CircleHelp size={14} />
                Guidance
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={() => setShowNLModal(true)}
              className="af2-btn af2-btn-sm"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Sparkles size={14} />
              Generate with AI
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className={clsx(
                "af2-btn af2-btn-sm",
                saved ? "af2-btn-clay" : undefined,
              )}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? "Saving..." : saved ? "Saved!" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowDeployModal(true)}
              disabled={template.steps.length === 0 || deployBusy}
              aria-label="Deploy workflow as agent team"
              className="af2-btn af2-btn-sm"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                opacity: template.steps.length === 0 || deployBusy ? 0.5 : 1,
              }}
            >
              {deployBusy ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
              Deploy as Team
            </button>
            <button
              type="button"
              onClick={handleRun}
              disabled={template.steps.length === 0}
              className="af2-btn af2-btn-sm af2-btn-primary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                opacity: template.steps.length === 0 ? 0.5 : 1,
              }}
            >
              <Play size={14} />
              Run
            </button>
          </div>
        </div>

        {/* HEL-27 Pro mode env panel — renders below the header when proMode
            is on. v1 surface: workspace env vars textarea (one KEY=VALUE
            per line) + a hint that values are passed to LLM/tool steps at
            run time. Persistence is HEL-27 follow-on (no env-vars table
            yet); for v1 the textarea is local UI state. */}
        {proMode ? (
          <div
            className="border-b border-af2-line px-6 py-3 text-sm"
            style={{ background: "var(--af2-paper-2)" }}
          >
            <div className="af2-eyebrow" style={{ marginBottom: 4 }}>
              Pro mode · Env panel
            </div>
            <div
              className="af2-mono af2-muted-2"
              style={{ fontSize: 11, marginBottom: 6 }}
            >
              KEY=value, one per line. Values are passed to LLM + tool steps at run time.
              Persistence is tracked under HEL-27 follow-on (no env-vars table yet).
            </div>
            <textarea
              className="af2-input"
              placeholder={"SLACK_DEFAULT_CHANNEL=#ops\nMAX_RETRIES=3"}
              rows={3}
              style={{
                width: "100%",
                fontFamily: "var(--af2-mono)",
                fontSize: 12,
                resize: "vertical",
              }}
              aria-label="Workspace environment variables"
            />
          </div>
        ) : null}

        {/* Canvas — HEL-100 v2: paper-2 surface with the existing dot
            grid (Background gap=20) matches docs/design/v2/styles.css
            (radial-gradient over var(--af2-paper-2)). */}
        <div className="relative flex-1 overflow-hidden bg-af2-paper-2">
          {template.steps.length === 0 ? (
            <EmptyCanvas onAdd={addStep} templates={allTemplates} />
          ) : (
            <>
              <ReactFlow
                fitView
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                minZoom={0.5}
                maxZoom={1.4}
                snapToGrid
                snapGrid={[20, 20]}
                onNodeClick={(_: unknown, node: WorkflowFlowNode) => setSelectedStepId(node.id)}
                onPaneClick={() => setSelectedStepId(null)}
                onConnect={handleConnect}
                onEdgesDelete={(deletedEdges: Edge[]) => {
                  if (deletedEdges.length === 0) return;
                  const deletedIds = new Set(deletedEdges.map((edge) => edge.id));
                  persistEdges(flowEdges.filter((edge) => !deletedIds.has(edge.id)));
                  setGraphError(null);
                }}
                onNodeDrag={(_: unknown, node: WorkflowFlowNode) => {
                  updateStepPosition(node.id, node.position);
                }}
                onNodeDragStop={(_: unknown, node: WorkflowFlowNode) => {
                  updateStepPosition(node.id, node.position);
                }}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={20}
                  size={2}
                  color="var(--af2-line)"
                />
                <Controls
                  position="bottom-right"
                  showInteractive={false}
                  className="workflow-controls-pill"
                />
                {/* HEL-100 v2: mini-map (top-right per AF2_Studio).
                    @xyflow/react ships <MiniMap />; the import is
                    type-augmented via src/xyflow-react.d.ts to work
                    around the package's wildcard re-export drop. Tints
                    via af2 tokens so it sits inside the v2 paper
                    aesthetic. */}
                <MiniMap
                  position="top-right"
                  pannable
                  zoomable
                  ariaLabel="Workflow mini-map"
                  className="workflow-minimap"
                  nodeStrokeColor="var(--af2-ink)"
                  nodeColor={() => "var(--af2-ink-2)"}
                  nodeBorderRadius={4}
                  maskColor="color-mix(in srgb, var(--af2-paper) 70%, transparent)"
                />
              </ReactFlow>
              <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
                <div className="pointer-events-auto rounded-full border border-af2-line bg-af2-card/95 px-2 py-1.5 shadow-af2 backdrop-blur">
                  <AddStepMenu onAdd={addStep} />
                </div>
              </div>
              {/* HEL-100 v2: run history strip — bottom-left of canvas
                  per AF2_Studio. Renders only when we actually have
                  runs to show (skipped for unsaved drafts + workflows
                  with zero runs). */}
              {runHistory.length > 0 && (
                <div className="pointer-events-none absolute bottom-4 left-4 z-10 w-[min(420px,calc(100%-260px))]">
                  <div className="pointer-events-auto">
                    <RunHistoryStrip runs={runHistory} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showCopilot && (
        <WorkflowCopilotSidebar
          messages={copilotMessages}
          input={copilotInput}
          onInputChange={setCopilotInput}
          onSubmit={() => void handleCopilotSubmit()}
          onClose={() => setShowCopilot(false)}
          onApply={handleApplyCopilotProposal}
          onReject={handleRejectCopilotProposal}
          busy={copilotBusy}
          model={copilotModel}
          onModelChange={setCopilotModel}
          references={copilotReferences}
          liveMessage={copilotLiveMessage}
        />
      )}

      {/* Right panel — step detail */}
      {selectedStep && (
        <div
          className={clsx(
            "animate-slide-up absolute top-0 z-20 h-full w-[360px] overflow-y-auto border-l border-af2-line bg-af2-card shadow-xl transition-transform duration-200",
            showCopilot ? "right-[360px]" : "right-0"
          )}
        >
          {/* HEL-100 v2 inspector header — mirrors AF2_Studio's
              InspectorBasic / InspectorPro: eyebrow ("Selected node" +
              " · Pro" when proMode is on) over a serif title (the
              selected step's display name) and a muted subtitle (its
              kind label). The editable Name field stays below in the
              form. */}
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-af2-line">
            <div className="min-w-0">
              <div className="af2-eyebrow">
                Selected node{proMode ? " · Pro" : ""}
              </div>
              <h3
                className="font-af2-serif text-af2-ink"
                style={{
                  marginTop: 6,
                  fontSize: 19,
                  fontWeight: 500,
                  letterSpacing: "-0.015em",
                }}
              >
                <span className="block truncate">{selectedStep.name}</span>
              </h3>
              <p className="mt-1 text-[12.5px] text-af2-ink-3">
                {KIND_META[selectedStep.kind]?.label ?? selectedStep.kind}
              </p>
            </div>
            <button
              onClick={() => setSelectedStepId(null)}
              aria-label="Close step inspector"
              className="shrink-0 rounded p-1 text-af2-ink-3 transition hover:bg-af2-paper-2 hover:text-af2-ink"
            >
              <X size={16} />
            </button>
          </div>

          {/* HEL-100 v2 Pro inspector tabs — when Pro mode is on, the
              right rail switches between Inspector / Versions /
              Observability per AF2_Studio. Inspector keeps the existing
              form; Versions + Observability are stub panels in this PR
              and get real data wiring in follow-ups. */}
          {proMode && (
            <div
              role="tablist"
              aria-label="Pro inspector tabs"
              className="flex items-center gap-1 border-b border-af2-line px-3 pt-3"
            >
              {(
                [
                  ["inspector", "Inspector"],
                  ["versions", "Versions"],
                  ["observability", "Observability"],
                ] as const
              ).map(([key, label]) => {
                const active = proInspectorTab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls={`pro-inspector-panel-${key}`}
                    onClick={() => setProInspectorTab(key)}
                    className={clsx(
                      "rounded-t-md border-b-2 px-3 py-2 text-xs font-medium transition",
                      active
                        ? "border-af2-clay text-af2-ink"
                        : "border-transparent text-af2-ink-3 hover:text-af2-ink"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {proMode && proInspectorTab === "versions" && (
            <VersionsPanel
              template={template}
              canonicalWorkflowId={canonicalWorkflowId}
              versions={workflowVersions}
              loading={versionsLoading}
              error={versionsError}
              actionError={versionsActionError}
              restoringVersionId={restoringVersionId}
              onCompare={(versionId) => setDiffTargetVersionId(versionId)}
              onRestore={handleRestoreVersion}
            />
          )}
          {proMode && proInspectorTab === "observability" && (
            <ObservabilityPanel runs={runHistory} />
          )}

          <div
            className={clsx(
              "p-5 space-y-5",
              proMode && proInspectorTab !== "inspector" ? "hidden" : "block"
            )}
            id={proMode ? "pro-inspector-panel-inspector" : undefined}
            role={proMode ? "tabpanel" : undefined}
          >
            <Field label="Name">
              <input
                className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30 bg-af2-card text-af2-ink"
                value={selectedStep.name}
                onChange={(e) => updateStep(selectedStep.id, { name: e.target.value })}
              />
            </Field>

            <Field label="Kind">
              <select
                className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30 bg-af2-card text-af2-ink"
                value={selectedStep.kind}
                onChange={(e) =>
                  updateStep(selectedStep.id, { kind: e.target.value as StepKind })
                }
              >
                {(Object.keys(KIND_META) as StepKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_META[k].label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Description">
              <textarea
                className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30 resize-none bg-af2-card text-af2-ink"
                rows={3}
                value={selectedStep.description}
                onChange={(e) =>
                  updateStep(selectedStep.id, { description: e.target.value })
                }
              />
            </Field>

            {selectedStep.kind === "llm" && (
              <Field label="Prompt Template">
                <textarea
                  className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30 resize-none font-mono text-xs"
                  rows={5}
                  placeholder="Use {{key}} for variable interpolation"
                  value={selectedStep.promptTemplate ?? ""}
                  onChange={(e) =>
                    updateStep(selectedStep.id, { promptTemplate: e.target.value })
                  }
                />
              </Field>
            )}

            {selectedStep.kind === "cron_trigger" && (
              <>
                <Field label="Cron Expression">
                  <div>
                    <input
                      aria-label="Cron Expression"
                      className={buildStepFieldClass({
                        mono: true,
                        hasError: !!cronValidationError,
                        flashSuccess: fieldFlashKey === cronFlashKey,
                      })}
                      placeholder="0 9 * * 1"
                      value={selectedStep.cronExpression ?? ""}
                      onChange={(e) => {
                        const cronExpression = e.target.value;
                        updateStep(selectedStep.id, { cronExpression });
                        if (!validateCronExpression(cronExpression)) {
                          flashField(`cron:${selectedStep.id}`);
                        }
                      }}
                    />
                    <p className="mt-1 text-xs text-af2-ink-3">
                      Standard crontab format.{" "}
                      <a
                        href="https://crontab.guru"
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium underline hover:text-af2-clay"
                      >
                        Learn more
                      </a>
                    </p>
                    {cronValidationError ? (
                      <p className="mt-1 text-xs text-af2-clay">{cronValidationError}</p>
                    ) : cronPreview ? (
                      <p className="mt-1 text-xs text-af2-ink-4">{cronPreview}</p>
                    ) : null}
                  </div>
                </Field>

                <Field label="Timezone">
                  <div>
                    <input
                      aria-label="Timezone"
                      list="workflow-builder-timezones"
                      className={buildStepFieldClass()}
                      placeholder="UTC"
                      value={selectedStep.timezone ?? "UTC"}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { timezone: e.target.value || "UTC" })
                      }
                    />
                    <datalist id="workflow-builder-timezones">
                      {timezoneOptions.map((timezone) => (
                        <option key={timezone} value={timezone} />
                      ))}
                    </datalist>
                  </div>
                </Field>
              </>
            )}

            {selectedStep.kind === "interval_trigger" && (
              <>
                <Field label="Interval (Minutes)">
                  <div>
                    <input
                      aria-label="Interval (Minutes)"
                      type="number"
                      min={1}
                      className={buildStepFieldClass({
                        hasError: !!intervalValidationError,
                        flashSuccess: fieldFlashKey === intervalFlashKey,
                      })}
                      value={selectedStep.intervalMinutes ?? ""}
                      onChange={(e) => {
                        const rawValue = e.target.value;
                        const intervalMinutes = rawValue === "" ? undefined : Number(rawValue);
                        updateStep(selectedStep.id, { intervalMinutes });
                        if (!validateIntervalMinutes(intervalMinutes)) {
                          flashField(`interval:${selectedStep.id}`);
                        }
                      }}
                    />
                    <p className="mt-1 text-xs text-af2-ink-3">
                      How often the workflow should execute.
                    </p>
                    {intervalValidationError && (
                      <p className="mt-1 text-xs text-af2-clay">{intervalValidationError}</p>
                    )}
                  </div>
                </Field>

                <Field label="Timezone">
                  <div>
                    <input
                      aria-label="Timezone"
                      list="workflow-builder-timezones"
                      className={buildStepFieldClass()}
                      placeholder="UTC"
                      value={selectedStep.timezone ?? "UTC"}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { timezone: e.target.value || "UTC" })
                      }
                    />
                    <datalist id="workflow-builder-timezones">
                      {timezoneOptions.map((timezone) => (
                        <option key={timezone} value={timezone} />
                      ))}
                    </datalist>
                  </div>
                </Field>
              </>
            )}

            {selectedStep.kind === "llm" && (
              <Field label="LLM Provider">
                {llmConfigsLoading ? (
                  <div className="w-full px-3 py-2 text-sm border border-af2-line rounded-lg text-af2-ink-4 bg-af2-paper-2">
                    Loading providers…
                  </div>
                ) : llmConfigsError ? (
                  <p className="text-xs text-af2-clay">{llmConfigsError}</p>
                ) : llmConfigs.length === 0 ? (
                  <div className="px-3 py-2.5 rounded-lg border border-af2-mustard/30 bg-af2-mustard/10 text-xs text-af2-mustard leading-relaxed">
                    No LLM providers connected.{" "}
                    <a href="/settings/llm-providers" className="underline font-medium hover:text-af2-mustard">
                      Go to Settings
                    </a>{" "}
                    to add one.
                  </div>
                ) : (
                  <select
                    className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30 bg-white"
                    value={selectedStep.llmConfigId ?? ""}
                    onChange={(e) =>
                      updateStep(selectedStep.id, {
                        llmConfigId: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">Account default</option>
                    {llmConfigs.map((cfg) => (
                      <option key={cfg.id} value={cfg.id}>
                        {cfg.label} ({cfg.provider} / {cfg.model})
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}

            {selectedStep.kind === "condition" && (
              <Field label="Condition Expression">
                <input
                  className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30 font-mono"
                  placeholder='e.g. urgency === "high"'
                  value={selectedStep.condition ?? ""}
                  onChange={(e) =>
                    updateStep(selectedStep.id, { condition: e.target.value })
                  }
                />
              </Field>
            )}

            {selectedStep.kind === "action" && (
              <Field label="Action Target">
                <input
                  className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30 font-mono"
                  placeholder="e.g. email.send"
                  value={selectedStep.action ?? ""}
                  onChange={(e) =>
                    updateStep(selectedStep.id, { action: e.target.value })
                  }
                />
              </Field>
            )}

            {selectedStep.kind === "agent" && (
              <>
                {latestDeployment && deploymentAgentByStepId.get(selectedStep.id) && (
                  <div className="rounded-xl border border-af2-sage/30 bg-af2-sage/10 px-4 py-3 text-sm text-af2-sage">
                    <p className="font-medium">This node is mapped to a deployed agent.</p>
                    <a
                      href={`/agents/team/${latestDeployment.team.id}?agent=${encodeURIComponent(
                        deploymentAgentByStepId.get(selectedStep.id)!.id
                      )}`}
                      className="mt-2 inline-flex text-xs font-semibold text-af2-sage underline"
                    >
                      Open agent detail
                    </a>
                  </div>
                )}
                <Field label="Role Key">
                  <input
                    className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                    placeholder="e.g. workflow-manager"
                    value={selectedStep.agentRoleKey ?? ""}
                    onChange={(e) =>
                      updateStep(selectedStep.id, { agentRoleKey: e.target.value })
                    }
                  />
                </Field>
                <Field label="Model">
                  <input
                    className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                    placeholder="e.g. claude-sonnet-4-6"
                    value={selectedStep.agentModel ?? ""}
                    onChange={(e) =>
                      updateStep(selectedStep.id, { agentModel: e.target.value })
                    }
                  />
                </Field>
                <Field label="Instructions">
                  <textarea
                    className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30 resize-none"
                    rows={4}
                    placeholder="System instructions for this agent…"
                    value={selectedStep.agentInstructions ?? ""}
                    onChange={(e) =>
                      updateStep(selectedStep.id, { agentInstructions: e.target.value })
                    }
                  />
                </Field>
                <Field label="Assigned Skills (comma-separated)">
                  <input
                    className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                    placeholder="paperclip, para-memory-files, security-review"
                    value={(selectedStep.agentSkills ?? []).join(", ")}
                    onChange={(e) =>
                      updateStep(selectedStep.id, {
                        agentSkills: e.target.value
                          .split(",")
                          .map((skill) => skill.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </Field>
                <Field label="Monthly Budget (USD)">
                  <input
                    type="number"
                    min={0}
                    step="1"
                    className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                    placeholder="0"
                    value={selectedStep.agentBudgetMonthlyUsd ?? 0}
                    onChange={(e) =>
                      updateStep(selectedStep.id, {
                        agentBudgetMonthlyUsd: Number(e.target.value) || 0,
                      })
                    }
                  />
                </Field>
                <Field label="Trigger Schedule">
                  <select
                    className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30 bg-white"
                    value={selectedStep.agentScheduleType ?? "manual"}
                    onChange={(e) =>
                      updateStep(selectedStep.id, {
                        agentScheduleType: e.target.value as WorkflowStep["agentScheduleType"],
                      })
                    }
                  >
                    <option value="manual">Manual handoff</option>
                    <option value="interval">Interval heartbeat</option>
                    <option value="cron">Cron schedule</option>
                  </select>
                </Field>
                {(selectedStep.agentScheduleType === "interval" ||
                  selectedStep.agentScheduleType === "cron") && (
                  <Field label={selectedStep.agentScheduleType === "interval" ? "Interval Minutes" : "Cron Expression"}>
                    <input
                      className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                      placeholder={selectedStep.agentScheduleType === "interval" ? "30" : "0 * * * *"}
                      value={selectedStep.agentScheduleValue ?? ""}
                      onChange={(e) =>
                        updateStep(selectedStep.id, { agentScheduleValue: e.target.value })
                      }
                    />
                  </Field>
                )}
                <Field label="Parallel Worker Slots">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                    placeholder="1"
                    value={selectedStep.subAgentSlots ?? 1}
                    onChange={(e) =>
                      updateStep(selectedStep.id, { subAgentSlots: parseInt(e.target.value, 10) || 1 })
                    }
                  />
                </Field>
              </>
            )}

            {selectedStep.kind === "approval" && (
              <>
                <Field label="Assignee (email or role)">
                  <input
                    className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                    placeholder="e.g. manager@company.com"
                    value={selectedStep.approvalAssignee ?? ""}
                    onChange={(e) =>
                      updateStep(selectedStep.id, { approvalAssignee: e.target.value })
                    }
                  />
                </Field>
                <Field label="Approval Request Message">
                  <textarea
                    className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30 resize-none"
                    rows={3}
                    placeholder="Please review and approve this step before continuing…"
                    value={selectedStep.approvalMessage ?? ""}
                    onChange={(e) =>
                      updateStep(selectedStep.id, { approvalMessage: e.target.value })
                    }
                  />
                </Field>
                <Field label="Timeout (minutes)">
                  <input
                    type="number"
                    min={1}
                    className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                    placeholder="60"
                    value={selectedStep.approvalTimeoutMinutes ?? 60}
                    onChange={(e) =>
                      updateStep(selectedStep.id, {
                        approvalTimeoutMinutes: parseInt(e.target.value, 10) || 60,
                      })
                    }
                  />
                </Field>
                <div className="px-3 py-2.5 rounded-lg border border-af2-mustard/30 bg-af2-mustard/10 text-xs text-af2-mustard leading-relaxed">
                  Workflow will pause at this step until the assignee approves or rejects. On timeout, the workflow escalates or continues based on your escalation policy.
                </div>
              </>
            )}

            {selectedStep.kind === "mcp" && (
              <>
                <Field label="Integration Server URL">
                  <input
                    className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30 font-mono"
                    placeholder="https://mcp.example.com/sse"
                    value={selectedStep.mcpServerUrl ?? ""}
                    onChange={(e) =>
                      updateStep(selectedStep.id, { mcpServerUrl: e.target.value })
                    }
                  />
                </Field>
                <Field label="Tool Name">
                  <input
                    className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30 font-mono"
                    placeholder="e.g. search_web"
                    value={selectedStep.mcpTool ?? ""}
                    onChange={(e) =>
                      updateStep(selectedStep.id, { mcpTool: e.target.value })
                    }
                  />
                </Field>
              </>
            )}

            {selectedStep.kind === "file_trigger" && (
              <Field label="Accepted File Types (comma-separated)">
                <input
                  className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                  placeholder=".pdf, .png, .jpg, .mp3, .wav"
                  value={(selectedStep.acceptedFileTypes ?? []).join(", ")}
                  onChange={(e) =>
                    updateStep(selectedStep.id, {
                      acceptedFileTypes: e.target.value
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
            )}

            <Field label="Input Keys (comma-separated)">
              <input
                className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                placeholder="key1, key2"
                value={selectedStep.inputKeys.join(", ")}
                onChange={(e) =>
                  updateStep(selectedStep.id, {
                    inputKeys: e.target.value
                      .split(",")
                      .map((k) => k.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>

            <Field label="Output Keys (comma-separated)">
              <input
                className="w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                placeholder="result1, result2"
                value={selectedStep.outputKeys.join(", ")}
                onChange={(e) =>
                  updateStep(selectedStep.id, {
                    outputKeys: e.target.value
                      .split(",")
                      .map((k) => k.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
          </div>
        </div>
      )}

      {/* File Upload Modal */}
      {showFileUploadModal && (
        <FileUploadModal
          templateId={template.id}
          acceptedFileTypes={fileTriggerStep?.acceptedFileTypes ?? []}
          onClose={() => setShowFileUploadModal(false)}
          onStarted={() => {
            setShowFileUploadModal(false);
            navigate("/monitor");
          }}
        />
      )}

      {/* NL Workflow Generation Modal */}
      {showNLModal && (
        <NLWorkflowModal
          onClose={() => setShowNLModal(false)}
          onApply={(steps) => {
            setTemplate((t) => ({ ...t, steps }));
            setShowNLModal(false);
          }}
        />
      )}

      {showDeployModal && (
        <DeployAsTeamModal
          template={template}
          busy={deployBusy}
          onClose={() => setShowDeployModal(false)}
          onDeploy={handleDeployTeam}
        />
      )}

      {showHelp && <WorkflowBuilderHelpPanel onClose={() => setShowHelp(false)} />}

      {diffTargetVersionId && canonicalWorkflowId && (
        <VersionDiffModal
          canonicalWorkflowId={canonicalWorkflowId}
          targetVersionId={diffTargetVersionId}
          latestVersionId={
            workflowVersions.find((v) => v.isLatest)?.id ?? null
          }
          onClose={() => setDiffTargetVersionId(null)}
        />
      )}
    </div>
  );
}

function WorkflowBuilderHelpPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-af2-paper-3/35">
      <button className="flex-1" onClick={onClose} aria-label="Close guidance" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Workflow guidance"
        className="w-full max-w-md overflow-y-auto border-l border-af2-line bg-af2-card p-6 shadow-xl"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-af2-clay">Workflow help</p>
            <h2 className="mt-1 text-lg font-semibold text-af2-ink">Build and launch confidently</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-af2-ink-3 transition hover:bg-af2-paper-2 hover:text-af2-ink"
            aria-label="Close guidance panel"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 text-sm text-af2-ink-2">
          <section className="rounded-lg border border-af2-line bg-af2-paper-2 p-4">
            <h3 className="font-medium text-af2-ink">Suggested flow</h3>
            <p className="mt-1">Trigger -&gt; LLM -&gt; Condition/Transform -&gt; Action -&gt; Output.</p>
          </section>

          <section className="rounded-lg border border-af2-line p-4">
            <h3 className="font-medium text-af2-ink">High-impact tips</h3>
            <ul className="mt-2 space-y-1 text-af2-ink-3">
              <li>Use clear step names so run logs are easy to debug.</li>
              <li>Define input/output keys on each step to avoid brittle data passing.</li>
              <li>Connect an LLM provider before testing any LLM step.</li>
            </ul>
          </section>

          <section className="rounded-lg border border-af2-line p-4">
            <h3 className="font-medium text-af2-ink">When runs fail</h3>
            <ul className="mt-2 space-y-1 text-af2-ink-3">
              <li>Validate the integration server URL and tool name for Integration steps.</li>
              <li>Check approval timeout for long-running approvals.</li>
              <li>Run from a smaller sample payload first, then scale.</li>
            </ul>
          </section>
        </div>
      </aside>
    </div>
  );
}

function NLWorkflowModal({
  onClose,
  onApply,
}: {
  onClose: () => void;
  onApply: (steps: WorkflowStep[]) => void;
}) {
  const { getAccessToken } = useAuth();
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<WorkflowStep[] | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const steps = await generateWorkflow(prompt.trim(), undefined, accessToken);
      setPreview(steps);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-af2-card rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-af2-line">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-af2-plum" />
            <h2 className="font-semibold text-af2-ink">Generate Workflow with AI</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-af2-paper-2">
            <X size={16} className="text-af2-ink-3" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-af2-ink-3 mb-1.5">
              Describe your workflow
            </label>
            <textarea
              className="w-full px-3 py-2.5 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-plum/30 bg-af2-card text-af2-ink resize-none"
              rows={4}
              placeholder="e.g. When a customer support email arrives, classify its intent, check if it's urgent, and send an automated reply or escalate to a human agent…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={generating}
            />
          </div>

          {generateError && (
            <p className="text-xs text-af2-clay">{generateError}</p>
          )}

          {!preview && (
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || generating}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-af2-plum hover:bg-af2-plum text-white text-sm font-medium transition disabled:opacity-50"
            >
              {generating ? (
                <>
                  <Loader size={15} className="animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles size={15} />
                  Generate Workflow
                </>
              )}
            </button>
          )}

          {preview && (
            <>
              <div>
                <p className="text-xs font-medium text-af2-ink-3 mb-2">
                  Preview — {preview.length} steps suggested
                </p>
                <div className="rounded-xl border border-af2-line divide-y divide-gray-100 overflow-hidden">
                  {preview.map((step, i) => {
                    const meta = KIND_META[step.kind];
                    return (
                      <div key={step.id} className="flex items-center gap-3 px-4 py-2.5 text-sm bg-af2-card">
                        <span className="text-af2-ink-4 text-xs w-4">{i + 1}</span>
                        <span className={clsx("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border", meta.chipBg, meta.chipColor)}>
                          {meta.icon}
                          {meta.label}
                        </span>
                        <span className="text-af2-ink font-medium flex-1">{step.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => onApply(preview)}
                  className="flex-1 py-2.5 rounded-lg bg-af2-plum hover:bg-af2-plum text-white text-sm font-medium transition"
                >
                  Apply to Canvas
                </button>
                <button
                  onClick={() => { setPreview(null); setPrompt(""); }}
                  className="px-4 py-2.5 rounded-lg border border-af2-line text-af2-ink-3 hover:bg-af2-paper-2 text-sm font-medium transition"
                >
                  Try Again
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkflowCopilotSidebar({
  messages,
  input,
  onInputChange,
  onSubmit,
  onClose,
  onApply,
  onReject,
  busy,
  model,
  onModelChange,
  references,
  liveMessage,
}: {
  messages: CopilotMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  onApply: (messageId: string, proposal: CopilotProposal) => void;
  onReject: (messageId: string) => void;
  busy: boolean;
  model: string;
  onModelChange: (model: string) => void;
  references: Array<{ id: string; label: string }>;
  liveMessage: string;
}) {
  const modelOptions = ["Fast", "Auto", "Advanced", "Behemoth"];

  return (
    <aside
      className="absolute right-0 top-0 z-20 flex h-full w-[360px] animate-slide-in-right flex-col border-l border-af2-line bg-white shadow-xl"
      role="dialog"
      aria-modal="false"
      aria-label="AutoFlow Copilot"
    >
      <div className="flex items-center justify-between border-b border-af2-line px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-af2-clay">
            AutoFlow Copilot
          </p>
          <h3 className="mt-1 text-sm font-semibold text-af2-ink">
            Ask, generate, and apply
          </h3>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-af2-ink-3 transition hover:bg-af2-paper-2"
          aria-label="Close copilot sidebar"
        >
          <X size={16} />
        </button>
      </div>

      <div className="border-b border-af2-line px-5 py-3">
        <label className="mb-1 block text-xs font-medium text-af2-ink-3">
          Reasoning mode
        </label>
        <select
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          className="w-full rounded-lg border border-af2-line-2 bg-white px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
        >
          {modelOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.length === 0 && (
          <div className="rounded-2xl border border-af2-clay/30 bg-af2-clay-soft/30 p-4 text-sm text-af2-clay">
            Ask AutoFlow Copilot to explain this workflow, generate a new sequence, or propose a targeted node change.
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className="space-y-2">
            <div
              className={clsx(
                "rounded-2xl border px-4 py-3 text-sm leading-relaxed",
                message.role === "user"
                  ? "border-af2-line bg-af2-paper-2 text-af2-ink-2"
                  : "border-af2-clay/30 bg-af2-clay-soft/30 text-af2-clay"
              )}
            >
              {message.content}
            </div>

            {message.proposal && (
              <div className="rounded-2xl border border-af2-sage/30 bg-af2-sage/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-af2-sage">
                      {message.proposal.title}
                    </p>
                    <p className="mt-1 text-sm text-af2-sage">
                      {message.proposal.summary}
                    </p>
                  </div>
                  <Sparkles size={16} className="mt-0.5 shrink-0 text-af2-sage" />
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => onApply(message.id, message.proposal!)}
                    className="rounded-lg bg-af2-sage px-3 py-2 text-sm font-medium text-white transition hover:bg-af2-sage/100"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => onReject(message.id)}
                    className="rounded-lg border border-af2-sage/30 px-3 py-2 text-sm font-medium text-af2-sage transition hover:bg-white"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="rounded-2xl border border-af2-clay/30 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay">
            <div className="mb-2 flex items-center gap-2">
              <Loader size={14} className="animate-spin" />
              AutoFlow Copilot is thinking…
            </div>
            <div className="h-1.5 rounded-full bg-af2-clay-soft/70">
              <div className="h-1.5 w-1/3 animate-glow-pulse rounded-full bg-af2-clay-soft/300" />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-af2-line px-5 py-4">
        <label htmlFor="workflow-copilot-input" className="mb-2 block text-xs font-medium text-af2-ink-3">
          Ask Copilot
        </label>
        <div className="rounded-2xl border border-af2-line bg-white p-2">
          <textarea
            id="workflow-copilot-input"
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            rows={4}
            placeholder="Add a Slack notification step after Step 3"
            className="w-full resize-none bg-transparent px-2 py-2 text-sm text-af2-ink outline-none placeholder:text-af2-ink-4"
          />
          <div className="flex items-center justify-between gap-2 px-2 pt-1">
            <span className="text-xs text-af2-ink-4">
              Use @ to reference steps on the canvas
            </span>
            <button
              onClick={onSubmit}
              disabled={!input.trim() || busy}
              className="inline-flex items-center gap-2 rounded-xl bg-af2-clay px-3 py-2 text-sm font-medium text-white transition hover:bg-af2-clay-soft/300 disabled:opacity-50"
            >
              <Send size={14} />
              Send
            </button>
          </div>
        </div>

        {references.length > 0 && (
          <div className="mt-3 rounded-xl border border-af2-line bg-white p-2">
            <p className="px-2 pb-1 text-xs font-medium text-af2-ink-3">
              References
            </p>
            <div className="space-y-1">
              {references.map((reference) => (
                <button
                  key={reference.id}
                  onClick={() => onInputChange(`${input}${input.endsWith("@") ? "" : " "}${reference.label} `)}
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-af2-ink-3 transition hover:bg-af2-paper-2"
                >
                  {reference.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div aria-live="polite" className="sr-only">
          {liveMessage}
        </div>
      </div>
    </aside>
  );
}

async function buildCopilotResponse(
  prompt: string,
  template: WorkflowTemplate,
  selectedStepId: string | null,
  accessToken?: string
): Promise<Pick<CopilotMessage, "content" | "proposal">> {
  const normalized = prompt.toLowerCase();

  if (normalized.includes("explain")) {
    return {
      content: summarizeWorkflow(template),
    };
  }

  const targetedProposal = buildTargetedProposal(prompt, template, selectedStepId);
  if (targetedProposal) {
    return {
      content: "I prepared a targeted canvas change based on your instruction.",
      proposal: targetedProposal,
    };
  }

  const generatedSteps = await generateWorkflow(prompt.trim(), undefined, accessToken);
  const mode: CopilotProposalMode = template.steps.length === 0 ? "replace" : "append";

  return {
    content:
      mode === "replace"
        ? "I drafted a workflow from your prompt and can apply it to the empty canvas."
        : "I drafted a workflow sequence from your prompt and can append it to the current canvas.",
    proposal: {
      mode,
      title: mode === "replace" ? "Generated workflow" : "Generated workflow extension",
      summary: `${generatedSteps.length} suggested step${generatedSteps.length === 1 ? "" : "s"} ready to apply.`,
      steps: generatedSteps,
    },
  };
}

function summarizeWorkflow(template: WorkflowTemplate): string {
  if (template.steps.length === 0) {
    return "The workflow canvas is empty. Ask me to generate a workflow or add a specific node.";
  }

  const orderedSteps = template.steps
    .map((step, index) => `${index + 1}. ${step.name} (${KIND_META[step.kind].label})`)
    .join(", ");

  return `This workflow contains ${template.steps.length} step${template.steps.length === 1 ? "" : "s"}: ${orderedSteps}.`;
}

function buildTargetedProposal(
  prompt: string,
  template: WorkflowTemplate,
  selectedStepId: string | null
): CopilotProposal | null {
  const normalized = prompt.toLowerCase();
  if (!/(add|insert|append)/.test(normalized)) return null;

  const suggestedStep = buildStepFromPrompt(normalized);
  if (!suggestedStep) return null;

  const match = normalized.match(/(?:after|following)\s+(?:step|node)\s+(\d+)/);
  const targetIndex = match ? Math.max(0, Number.parseInt(match[1], 10) - 1) : -1;
  const fallbackTargetId =
    selectedStepId ?? template.steps[template.steps.length - 1]?.id;
  const targetStepId = targetIndex >= 0 ? template.steps[targetIndex]?.id : fallbackTargetId;

  return {
    mode: "insert_after",
    title: `Proposed change · ${suggestedStep.name}`,
    summary: targetStepId
      ? `Insert this step after the referenced canvas node.`
      : `Add this step to the current workflow.`,
    steps: [suggestedStep],
    targetStepId,
  };
}

function buildStepFromPrompt(prompt: string): WorkflowStep | null {
  const baseStep = {
    id: `step-${Date.now()}`,
    description: "",
    inputKeys: [],
    outputKeys: [],
  };

  if (prompt.includes("slack")) {
    return {
      ...baseStep,
      name: "Send Slack notification",
      kind: "action",
      action: "slack.send",
      inputKeys: ["message"],
      outputKeys: ["deliveryStatus"],
      description: "Deliver a Slack notification after the prior step completes.",
    };
  }

  if (prompt.includes("email")) {
    return {
      ...baseStep,
      name: "Send email update",
      kind: "action",
      action: "email.send",
      inputKeys: ["subject", "body"],
      outputKeys: ["deliveryStatus"],
      description: "Send an outbound email from the workflow.",
    };
  }

  if (prompt.includes("approval")) {
    return {
      ...baseStep,
      name: "Approval gate",
      kind: "approval",
      approvalTimeoutMinutes: 60,
      description: "Pause for human approval before the workflow continues.",
      inputKeys: ["approvalRequest"],
      outputKeys: ["approvalDecision"],
    };
  }

  if (prompt.includes("condition")) {
    return {
      ...baseStep,
      name: "Decision branch",
      kind: "condition",
      condition: 'result === "approved"',
      description: "Branch the workflow based on a condition.",
      inputKeys: ["result"],
      outputKeys: ["branch"],
    };
  }

  if (prompt.includes("llm")) {
    return {
      ...baseStep,
      name: "Draft with LLM",
      kind: "llm",
      promptTemplate: "Summarize {{input}} for the next workflow step.",
      description: "Generate or transform content with an LLM.",
      inputKeys: ["input"],
      outputKeys: ["response"],
    };
  }

  return {
    ...baseStep,
    name: "Follow-up action",
    kind: "action",
    action: "task.execute",
    description: "Perform a follow-up action generated from your prompt.",
    inputKeys: ["payload"],
    outputKeys: ["result"],
  };
}

function applyCopilotProposal(
  template: WorkflowTemplate,
  proposal: CopilotProposal
): WorkflowTemplate {
  if (proposal.mode === "replace") {
    return { ...template, steps: proposal.steps };
  }

  if (proposal.mode === "append") {
    return { ...template, steps: [...template.steps, ...proposal.steps] };
  }

  if (!proposal.targetStepId) {
    return { ...template, steps: [...template.steps, ...proposal.steps] };
  }

  const targetIndex = template.steps.findIndex((step) => step.id === proposal.targetStepId);
  if (targetIndex === -1) {
    return { ...template, steps: [...template.steps, ...proposal.steps] };
  }

  const nextSteps = [...template.steps];
  nextSteps.splice(targetIndex + 1, 0, ...proposal.steps);
  return { ...template, steps: nextSteps };
}

type AgentSlotDefinition = {
  key: "model" | "memory" | "tools";
  label: string;
  value: string | null;
  helper: string;
  accent: string;
  tint: string;
  border: string;
  icon: React.ReactNode;
};

function readAgentConfig(step: WorkflowStep): Record<string, unknown> {
  return typeof step.config === "object" && step.config !== null
    ? (step.config as Record<string, unknown>)
    : {};
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function formatSlotList(values: string[]): string | null {
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  if (values.length === 2) return values.join(" + ");
  return `${values[0]} +${values.length - 1}`;
}

function buildAgentSlotDefinitions(step: WorkflowStep): AgentSlotDefinition[] {
  const config = readAgentConfig(step);
  const modelValue = step.agentModel?.trim() || null;
  const memoryValue =
    (typeof config.agentMemoryLabel === "string" && config.agentMemoryLabel.trim()) ||
    (typeof config.memoryLabel === "string" && config.memoryLabel.trim()) ||
    formatSlotList(
      readStringList(config.memorySources).concat(
        step.inputKeys.filter((key) => /memory|context|history|knowledge/i.test(key))
      )
    ) ||
    ((config.memory === true || config.memoryEnabled === true) ? "Connected" : null);
  const toolsValue =
    (typeof config.agentToolsLabel === "string" && config.agentToolsLabel.trim()) ||
    (typeof config.toolsLabel === "string" && config.toolsLabel.trim()) ||
    formatSlotList(readStringList(config.tools).concat(readStringList(config.agentTools)));

  return [
    {
      key: "model",
      label: "Model",
      value: modelValue,
      helper: modelValue ? "Primary reasoning layer" : "Snap in a model",
      accent: "#6366f1",
      tint: "rgba(99,102,241,0.16)",
      border: "rgba(99,102,241,0.34)",
      icon: <Cpu size={14} />,
    },
    {
      key: "memory",
      label: "Memory",
      value: memoryValue,
      helper: memoryValue ? "Context stays attached" : "Attach memory",
      accent: "#14b8a6",
      tint: "rgba(20,184,166,0.16)",
      border: "rgba(20,184,166,0.34)",
      icon: <Database size={14} />,
    },
    {
      key: "tools",
      label: "Tools",
      value: toolsValue,
      helper: toolsValue ? "Actions ready to call" : "Attach tools",
      accent: "#f97316",
      tint: "rgba(249,115,22,0.16)",
      border: "rgba(249,115,22,0.34)",
      icon: <Wrench size={14} />,
    },
  ];
}

function AgentSlots({ step }: { step: WorkflowStep }) {
  // HEL-100 v2: AgentSlots flipped from slate-950 dark card to a v2
  // light card on af2 tokens. Slot accent tints (slot.tint, slot.border,
  // slot.accent) keep their per-kind colour so model / memory / tools
  // remain visually distinct.
  const slotDefinitions = buildAgentSlotDefinitions(step);

  return (
    <div
      className="mt-4 rounded-[10px] border border-af2-line bg-af2-paper-2 p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-af2-ink-3">
            Modular Attachments
          </p>
          <p className="mt-1 text-xs text-af2-ink-3">
            {Math.max(1, step.subAgentSlots ?? 1)} worker slot{(step.subAgentSlots ?? 1) === 1 ? "" : "s"} fan out from this agent.
          </p>
        </div>
        <div className="rounded-full border border-af2-line bg-af2-card px-2.5 py-1 text-[11px] font-medium text-af2-ink-2">
          {step.subAgentSlots ?? 1} parallel
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {slotDefinitions.map((slot) => {
          const isEmpty = !slot.value;
          return (
            <div
              key={slot.key}
              className={clsx(
                "min-h-[98px] rounded-[10px] border bg-af2-card p-3 transition-transform duration-150",
                isEmpty ? "border-dashed" : ""
              )}
              style={{
                borderColor: isEmpty ? slot.border : "var(--af2-line)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-[9px] border"
                  style={{ borderColor: slot.border, backgroundColor: slot.tint, color: slot.accent }}
                >
                  {slot.icon}
                </div>
                {isEmpty && (
                  <div
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed text-af2-ink-4"
                    style={{ borderColor: slot.border }}
                    aria-hidden="true"
                  >
                    <Plus size={12} />
                  </div>
                )}
              </div>

              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-af2-ink-3">
                {slot.label}
              </p>
              <p className={clsx("mt-2 text-sm font-medium", isEmpty ? "text-af2-ink-4" : "text-af2-ink")}>
                {slot.value ?? "Empty"}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-af2-ink-3">
                {slot.helper}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkflowStepNode({
  id,
  data,
  selected,
  dragging,
}: NodeProps<WorkflowFlowNode>) {
  return (
    <div className="w-[280px]">
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-af2-ink-3" />
      <StepNode
        step={data.step}
        selected={selected ?? false}
        dragging={dragging ?? false}
        teamAgent={data.teamAgent}
        teamAgentHref={data.teamAgentHref}
        onSelect={() => data.onSelect(id)}
        onMoveUp={() => data.onMoveUp(id)}
        onMoveDown={() => data.onMoveDown(id)}
        onRemove={() => data.onRemove(id)}
        isFirst={data.isFirst}
        isLast={data.isLast}
      />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-af2-ink-3" />
    </div>
  );
}

function StepNode({
  step,
  selected,
  dragging,
  teamAgent,
  teamAgentHref,
  onSelect,
  onMoveUp,
  onMoveDown,
  onRemove,
  isFirst,
  isLast,
}: {
  step: WorkflowStep;
  selected: boolean;
  dragging: boolean;
  teamAgent?: ControlPlaneAgent;
  teamAgentHref?: string;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  // HEL-100 v2 node card: dropped the slate-800 dark variant for agent
  // nodes. All nodes now share the v2 light card chrome on af2 tokens;
  // the "Agent" kind keeps its own distinguishing chip + slot grid
  // below.
  const meta = KIND_META[step.kind];
  const visualState = readNodeVisualState(step);
  const showSuccessState = visualState === "success";
  const showErrorState = visualState === "error";
  const showRunningState = visualState === "running";

  return (
    <div
      onClick={onSelect}
      className={clsx(
        "group workflow-step-node relative cursor-pointer overflow-hidden rounded-[12px] border bg-af2-card shadow-af2 transition-all",
        selected
          ? "border-2 border-af2-clay ring-2 ring-af2-clay/20"
          : "border border-af2-line-2 hover:border-af2-clay/40",
        dragging ? "opacity-90 shadow-af2-lg" : "",
        showRunningState ? "workflow-node-running" : "",
        showSuccessState ? "workflow-node-success" : "",
        showErrorState ? "workflow-node-error" : ""
      )}
    >
      <div
        className="h-10 border-b border-black/5 px-4"
        style={{ backgroundColor: meta.categoryTint }}
      >
        <div className="flex h-full items-center gap-2 text-xs font-medium text-af2-ink-2">
          <span style={{ color: meta.categoryBorder }}>{meta.icon}</span>
          {meta.label}
          {showRunningState && <Loader size={12} className="ml-auto animate-spin text-af2-clay" />}
          {showSuccessState && <CheckCircle2 size={12} className="ml-auto text-af2-sage" />}
          {showErrorState && <AlertCircle size={12} className="ml-auto text-af2-clay" />}
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={clsx(
              "mt-0.5 flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium",
              meta.chipBg,
              meta.chipColor,
            )}
          >
            {meta.icon}
            {meta.label}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-af2-ink">{step.name}</p>
            {step.description && (
              <p className="mt-0.5 truncate text-xs text-af2-ink-3">
                {step.description}
              </p>
            )}
          </div>
        </div>

        {/* IO keys */}
        {(step.inputKeys.length > 0 || step.outputKeys.length > 0) && (
          <div className="mt-3 flex gap-4 text-xs">
            {step.inputKeys.length > 0 && (
              <div>
                <span className="mr-1 text-af2-ink-4">in:</span>
                {step.inputKeys.map((k) => (
                  <span
                    key={k}
                    className="mr-1 rounded bg-af2-paper-2 px-1.5 py-0.5 text-af2-ink-3"
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
            {step.outputKeys.length > 0 && (
              <div>
                <span className="mr-1 text-af2-ink-4">out:</span>
                {step.outputKeys.map((k) => (
                  <span
                    key={k}
                    className="mr-1 rounded bg-af2-clay-soft/30 px-1.5 py-0.5 text-af2-clay"
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Agent slots — spec-driven modular layout for model, memory, and tools */}
        {step.kind === "agent" && (
          <>
            <div className="mt-3 grid gap-2 text-xs text-af2-ink-3">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-af2-clay/30 bg-af2-clay-soft/30 px-2 py-1 font-medium text-af2-clay">
                  {step.agentRoleKey ?? "custom-agent"}
                </span>
                <span className="rounded-full border border-af2-line bg-af2-paper-2 px-2 py-1 font-medium text-af2-ink-3">
                  ${step.agentBudgetMonthlyUsd ?? 0}/mo
                </span>
                {teamAgent && (
                  <span className="rounded-full border border-af2-sage/30 bg-af2-sage/10 px-2 py-1 font-medium capitalize text-af2-sage">
                    {teamAgent.status}
                  </span>
                )}
              </div>
              {step.agentSkills && step.agentSkills.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {step.agentSkills.slice(0, 3).map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-af2-paper-2 px-2 py-0.5 text-[11px] font-medium text-af2-ink-3"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <AgentSlots step={step} />
            {teamAgentHref && (
              <a
                href={teamAgentHref}
                onClick={(event) => event.stopPropagation()}
                className="mt-3 inline-flex items-center gap-1 rounded-full border border-af2-sage/30 bg-af2-sage/10 px-3 py-1.5 text-[11px] font-semibold text-af2-sage transition hover:bg-af2-sage/20"
              >
                <Bot size={11} />
                View deployed agent
              </a>
            )}
          </>
        )}
      </div>

      {/* Actions (show on hover) */}
      <div className="absolute right-3 top-3 hidden group-hover:flex items-center gap-1">
        {!isFirst && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            className="p-1 rounded hover:bg-af2-paper-2 text-af2-ink-4 hover:text-af2-ink-2"
            title="Move step up"
            aria-label="Move step up"
          >
            <ChevronUp size={14} />
          </button>
        )}
        {!isLast && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            className="p-1 rounded hover:bg-af2-paper-2 text-af2-ink-4 hover:text-af2-ink-2"
            title="Move step down"
            aria-label="Move step down"
          >
            <ChevronDown size={14} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-1 rounded hover:bg-af2-clay-soft/30 text-af2-ink-4 hover:text-af2-clay"
          title="Delete step"
          aria-label="Delete step"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// HEL-100 v2 run history strip — bottom of canvas per AF2_Studio.
// Renders the last ~30 runs of this workflow as a 32px sparkline plus
// a "p50 X · p99 Y · Z% ok" stat line. Bar height = duration normalized
// against the slowest completed run; bar tint = status (sage for ok,
// clay for fail, mustard for in-flight). Pure presentational — the
// caller supplies pre-sorted, pre-trimmed runs.
function RunHistoryStrip({ runs }: { runs: WorkflowRun[] }) {
  const durations: number[] = runs.flatMap((run) => {
    if (run.status !== "completed" || !run.completedAt) return [];
    const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
    return ms > 0 && Number.isFinite(ms) ? [ms] : [];
  });
  const okCount = runs.filter((r) => r.status === "completed").length;
  const totalForOkRate = runs.filter(
    (r) => r.status === "completed" || r.status === "failed",
  ).length;
  const okPct = totalForOkRate > 0
    ? Math.round((okCount / totalForOkRate) * 100)
    : 100;

  // Render newest → oldest left-to-right, so the rightmost bar is the
  // most recent run (matches AF2_Studio's "last 30 runs" reading order).
  const ordered = [...runs].reverse();
  const maxDuration = durations.length > 0 ? Math.max(...durations) : 1;

  return (
    <div className="af2-card" style={{ padding: "10px 14px" }}>
      <div className="flex items-center gap-3">
        <span className="af2-eyebrow">Last {runs.length} runs</span>
        <span className="ml-auto font-af2-mono text-[11px] text-af2-ink-3">
          {durations.length > 0 ? `p50 ${formatRunMs(percentile(durations, 50))} · ` : ""}
          {durations.length > 0 ? `p99 ${formatRunMs(percentile(durations, 99))} · ` : ""}
          {okPct}% ok
        </span>
      </div>
      <div className="mt-2 flex h-8 items-end gap-[3px]">
        {ordered.map((run) => {
          const ms =
            run.completedAt && run.status === "completed"
              ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
              : 0;
          // Min 6px so even instant runs are visible; max 28px (the
          // 32px height minus 4px padding).
          const height = ms > 0
            ? 6 + (ms / maxDuration) * 22
            : 6;
          const tone =
            run.status === "completed"
              ? "var(--af2-sage)"
              : run.status === "failed"
                ? "var(--af2-clay)"
                : "var(--af2-mustard)";
          return (
            <div
              key={run.id}
              title={`${run.status} · ${formatRunMs(ms)}`}
              className="w-2 rounded-[1px]"
              style={{
                height,
                background: tone,
                opacity: 0.85,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function percentile(sortedSource: number[], p: number): number {
  if (sortedSource.length === 0) return 0;
  const sorted = [...sortedSource].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))] ?? 0;
}

function formatRunMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// HEL-100 v2 left rail. Mirrors docs/design/v2/studio.jsx::AF2_Studio
// — three sections (Triggers / Tools / Logic), each item clickable.
// Sections are derived from KIND_META so adding a new StepKind there
// flows through here (after assigning it to a section below).
const STUDIO_PALETTE_SECTIONS: Array<{
  title: string;
  kinds: StepKind[];
}> = [
  {
    title: "Triggers",
    kinds: ["trigger", "cron_trigger", "interval_trigger", "file_trigger"],
  },
  {
    title: "Tools",
    kinds: ["llm", "transform", "action", "mcp", "agent"],
  },
  {
    title: "Logic",
    kinds: ["condition", "approval", "output"],
  },
];

function StudioPalette({ onAdd }: { onAdd: (kind: StepKind) => void }) {
  return (
    <aside
      data-testid="studio-palette"
      aria-label="Node palette"
      className="hidden w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-af2-line bg-af2-paper px-4 py-5 lg:flex"
    >
      {STUDIO_PALETTE_SECTIONS.map((section) => (
        <div key={section.title}>
          <p
            className="af2-eyebrow"
            style={{ marginBottom: 8 }}
          >
            {section.title}
            <span
              aria-hidden="true"
              className="ml-2 font-af2-mono text-af2-ink-4"
              style={{ fontSize: 10.5 }}
            >
              · {section.kinds.length}
            </span>
          </p>
          <ul className="space-y-1.5" role="list">
            {section.kinds.map((kind) => {
              const meta = KIND_META[kind];
              return (
                <li key={kind}>
                  <button
                    type="button"
                    onClick={() => onAdd(kind)}
                    aria-label={`Add ${meta.label} step`}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-af2-line bg-af2-card px-3 py-2 text-left text-[13px] text-af2-ink-2 transition hover:border-af2-line-2 hover:bg-af2-paper-2 hover:text-af2-ink"
                  >
                    <span
                      className={clsx(
                        "flex h-6 w-6 items-center justify-center rounded border",
                        meta.chipBg,
                        meta.chipColor,
                      )}
                    >
                      {meta.icon}
                    </span>
                    <span className="truncate">{meta.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
}

function AddStepMenu({ onAdd }: { onAdd: (k: StepKind) => void }) {
  const [open, setOpen] = useState(false);
  const kinds = Object.entries(KIND_META) as [StepKind, (typeof KIND_META)[StepKind]][];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={clsx(
          "flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition",
          open
            ? "border-af2-clay/30 bg-af2-clay-soft/30 text-af2-clay"
            : "border-af2-line-2 text-af2-ink-3 hover:border-af2-clay/30 hover:text-af2-clay"
        )}
      >
        <Plus size={16} /> Node Palette
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 z-10 w-56 -translate-x-1/2 rounded-2xl border border-af2-line bg-af2-card p-2 shadow-lg">
          {kinds.map(([kind, meta]) => (
            <button
              key={kind}
              onClick={() => { onAdd(kind); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded-lg hover:bg-af2-paper-2 transition text-af2-ink-2"
            >
              <span className={clsx("rounded p-1", meta.chipBg, meta.chipColor)}>{meta.icon}</span>
              {meta.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * EmptyCanvas (UX-15 redesign) — first impression of the Studio canvas
 * for a brand-new (or freshly-cleared) workflow. Pre-UX-15 this was a
 * decent-but-bare "Add a step" prompt that left first-time owners
 * staring at a logo icon with no narrative for what a workflow IS.
 *
 * New layout:
 *   - Colored welcome band (clay) with eyebrow + h2.
 *   - One-sentence "What's a workflow?" explainer.
 *   - 3-step visual guide: Input → Process → Output, each with an
 *     icon + a one-line description so the concept of "steps that
 *     pass data" is concrete before they click anything.
 *   - Primary path: AddStepMenu with the "Add your first step" CTA.
 *   - Templates section is visually elevated with a heading + helper
 *     copy ("Don't know where to start? Pick a template and tweak it.")
 *     and slightly chunkier cards. Hidden entirely when no templates
 *     so the empty-empty case stays clean.
 */
function EmptyCanvas({
  onAdd,
  templates,
}: {
  onAdd: (k: StepKind) => void;
  templates: TemplateSummary[];
}) {
  return (
    <div className="h-full overflow-y-auto px-6 py-10">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center text-center">
        {/* Welcome band */}
        <div
          className="mb-6 w-full rounded-2xl border border-af2-clay/20 px-6 py-5"
          style={{
            background:
              "linear-gradient(135deg, rgba(192,84,76,0.06), rgba(192,142,58,0.04))",
          }}
        >
          <div className="mb-2 inline-flex items-center gap-2">
            <Zap size={14} className="text-af2-clay" />
            <span className="af2-eyebrow" style={{ color: "var(--af2-clay)" }}>
              Build · Studio
            </span>
          </div>
          <h3 className="font-af2-serif text-xl font-semibold text-af2-ink">
            Compose a workflow your team can run.
          </h3>
          <p className="mt-1.5 text-sm text-af2-ink-3 max-w-xl mx-auto">
            A workflow is a sequence of steps. Each step takes data, does
            something with it (call an LLM, hit an integration, ask a human),
            and passes its output forward.
          </p>
        </div>

        {/* 3-step concept walkthrough */}
        <div className="mb-7 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          <ConceptStep
            number={1}
            title="Input"
            body="A trigger fires the workflow — a schedule, a webhook, or an owner clicking 'Run now'."
          />
          <ConceptStep
            number={2}
            title="Process"
            body="LLM steps, integration calls, transforms, agent handoffs, approvals — chained however you need."
          />
          <ConceptStep
            number={3}
            title="Output"
            body="The final step writes a result somewhere your team uses — Slack, a doc, a database, an email."
          />
        </div>

        {/* Primary CTA */}
        <div className="mb-2 text-xs uppercase tracking-[0.18em] text-af2-ink-4">
          Ready to build?
        </div>
        <div className="mb-2">
          <AddStepMenu onAdd={onAdd} />
        </div>
        <p className="mb-8 max-w-xs text-xs text-af2-ink-4">
          Pick a step type and drop it on the canvas. You can rearrange them
          later.
        </p>

        {/* Templates */}
        {templates.length > 0 && (
          <div className="w-full">
            <div className="mb-2 flex items-baseline justify-between">
              <div className="af2-eyebrow text-af2-ink-2">
                Or start from a template
              </div>
              <span className="text-[11px] text-af2-ink-4">
                {templates.length} available
              </span>
            </div>
            <p className="mb-3 text-xs text-af2-ink-4 max-w-xl text-left">
              Pre-built workflows you can fork and edit. Open one to see how the
              steps connect, then tweak it for your own use.
            </p>
            <div
              aria-label="Workflow templates"
              className="max-h-[min(40vh,26rem)] overflow-y-auto rounded-2xl border border-af2-line bg-white/85 p-3 shadow-sm backdrop-blur"
            >
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {templates.map((t) => (
                  <a
                    key={t.id}
                    href={`/builder/${t.id}`}
                    className="group flex flex-col gap-1 rounded-xl border border-af2-line bg-white px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:border-af2-clay/40 hover:shadow-sm"
                  >
                    <span className="text-[13px] font-medium text-af2-ink group-hover:text-af2-clay">
                      {t.name}
                    </span>
                    <span className="text-[11px] text-af2-ink-4">
                      Open template →
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConceptStep({
  number,
  title,
  body,
}: {
  number: number;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-af2-line bg-white/80 px-4 py-3 text-left backdrop-blur">
      <div className="mb-1.5 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-af2-clay-soft text-[10px] font-bold text-af2-clay"
          style={{
            fontFamily:
              "var(--af2-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
          }}
        >
          {number}
        </span>
        <span className="text-[13px] font-semibold text-af2-ink">{title}</span>
      </div>
      <p className="text-[12px] leading-relaxed text-af2-ink-3">{body}</p>
    </div>
  );
}

// HEL-100 v2 Pro inspector — Versions panel. Renders the immutable
// workflow_versions list (newest first) for canonicalized workflows;
// drafts (no canonicalWorkflowId yet, i.e. never been saved) fall back
// to a "draft · v{template.version}" pill with a one-line explanation.
//
// Each non-latest row exposes Compare + Restore actions:
//   · Compare opens the VersionDiffModal (this version vs the current
//     latest) — step-level diff (added / removed / changed) computed
//     from the two dag.steps arrays.
//   · Restore fetches this version's dag and POSTs it as a new latest
//     via createCanonicalWorkflowVersion(). History is never destroyed;
//     the restored copy becomes a brand-new workflow_versions row.
function VersionsPanel({
  template,
  canonicalWorkflowId,
  versions,
  loading,
  error,
  actionError,
  restoringVersionId,
  onCompare,
  onRestore,
}: {
  template: WorkflowTemplate;
  canonicalWorkflowId: string | null;
  versions: CanonicalWorkflowVersionSummary[];
  loading: boolean;
  error: string | null;
  actionError: string | null;
  restoringVersionId: string | null;
  onCompare: (versionId: string) => void;
  onRestore: (versionId: string) => void;
}) {
  return (
    <div
      id="pro-inspector-panel-versions"
      role="tabpanel"
      className="p-5 space-y-3"
    >
      <div className="af2-eyebrow">Versions</div>

      {/* Draft state — workflow has never been canonicalized (never
          saved). Show the v{template.version} marker only. */}
      {!canonicalWorkflowId && (
        <>
          <div className="af2-card flex items-center gap-3 p-3">
            <span className="font-af2-mono text-[12px] font-semibold text-af2-ink">
              v{template.version || "1.0.0"}
            </span>
            <span className="af2-pill">
              <span className="af2-dot" />
              draft
            </span>
            <div className="ml-auto text-[11px] text-af2-ink-3">
              Save to start version history
            </div>
          </div>
          <p className="text-[12px] leading-5 text-af2-ink-3">
            Edits create immutable workflow_versions rows on save.
          </p>
        </>
      )}

      {/* Loading / error states. */}
      {canonicalWorkflowId && loading && (
        <p className="text-[12px] text-af2-ink-3">Loading versions…</p>
      )}
      {canonicalWorkflowId && error && !loading && (
        <div className="rounded-2xl border border-af2-clay/40 bg-af2-clay/10 px-3 py-2 text-[12px] text-af2-clay">
          {error}
        </div>
      )}

      {/* Loaded list. */}
      {canonicalWorkflowId && !loading && !error && (
        <>
          {actionError && (
            <div className="rounded-2xl border border-af2-clay/40 bg-af2-clay/10 px-3 py-2 text-[12px] text-af2-clay">
              {actionError}
            </div>
          )}
          {versions.length === 0 ? (
            <p className="text-[12px] text-af2-ink-3">
              No versions saved yet for this workflow.
            </p>
          ) : (
            <ul className="space-y-2" role="list">
              {versions.map((v) => {
                const restoring = restoringVersionId === v.id;
                const anyRestoring = restoringVersionId !== null;
                return (
                  <li
                    key={v.id}
                    className="af2-card flex flex-col gap-2 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-af2-mono text-[12px] font-semibold text-af2-ink">
                        v{v.version}
                      </span>
                      {v.isLatest && (
                        <span className="af2-pill af2-pill-live">
                          <span className="af2-dot" />
                          current
                        </span>
                      )}
                      <div className="ml-auto text-[11px] text-af2-ink-3">
                        {formatVersionTimestamp(v.createdAt)}
                      </div>
                    </div>
                    {!v.isLatest && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onCompare(v.id)}
                          disabled={anyRestoring}
                          className="af2-btn af2-btn-sm"
                          aria-label={`Compare v${v.version} against current`}
                        >
                          Compare
                        </button>
                        <button
                          type="button"
                          onClick={() => onRestore(v.id)}
                          disabled={anyRestoring}
                          className="af2-btn af2-btn-sm af2-btn-clay"
                          aria-label={`Restore v${v.version}`}
                        >
                          {restoring ? (
                            <Loader size={12} className="mr-1 inline animate-spin" />
                          ) : null}
                          Restore
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[11px] leading-4 text-af2-ink-4">
            Restore creates a new version with the older dag — history
            is preserved.
          </p>
        </>
      )}
    </div>
  );
}

// HEL-100 v2 Versions diff modal. Fetches the target version + the
// current latest via GET /api/workflows/:wf/versions/:id, then computes
// a step-level diff from `dag.steps`. Step-level (not byte-level) is
// the right resolution here — a workflow author thinks in steps, not
// JSON keys, and a structural diff is robust to incidental ordering
// or whitespace.
function VersionDiffModal({
  canonicalWorkflowId,
  targetVersionId,
  latestVersionId,
  onClose,
}: {
  canonicalWorkflowId: string;
  targetVersionId: string;
  latestVersionId: string | null;
  onClose: () => void;
}) {
  const { requireAccessToken } = useAuth();
  const [target, setTarget] = useState<CanonicalWorkflowVersionDetail | null>(
    null,
  );
  const [latest, setLatest] = useState<CanonicalWorkflowVersionDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    async function load() {
      try {
        const accessToken = await requireAccessToken();
        const targetPromise = getCanonicalWorkflowVersion(
          canonicalWorkflowId,
          targetVersionId,
          accessToken,
        );
        const latestPromise = latestVersionId
          ? getCanonicalWorkflowVersion(
              canonicalWorkflowId,
              latestVersionId,
              accessToken,
            )
          : Promise.resolve<CanonicalWorkflowVersionDetail | null>(null);
        const [t, l] = await Promise.all([targetPromise, latestPromise]);
        if (cancelled) return;
        setTarget(t);
        setLatest(l);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load diff");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canonicalWorkflowId, targetVersionId, latestVersionId, requireAccessToken]);

  // Esc closes the modal — matches the pattern of the other Studio
  // modals (DeployAsTeamModal, FileUploadModal).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const diff = useMemo(() => {
    if (!target || !latest) return null;
    return computeStepDiff(extractSteps(target.dag), extractSteps(latest.dag));
  }, [target, latest]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-af2-ink/55 backdrop-blur-[2px] px-4">
      <div className="af2-card max-h-[90vh] w-full max-w-3xl overflow-hidden shadow-af2-lg">
        <div className="flex items-center justify-between gap-4 border-b border-af2-line px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-clay">
              Compare versions
            </p>
            <h2 className="font-af2-serif mt-1 text-xl font-medium text-af2-ink">
              {target && latest
                ? `v${target.version} → v${latest.version} (current)`
                : "Loading…"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close diff modal"
            className="rounded-full border border-af2-line p-2 text-af2-ink-3 transition hover:border-af2-line-2 hover:bg-af2-paper-2 hover:text-af2-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[calc(90vh-140px)] overflow-y-auto p-6">
          {loading && (
            <p className="text-[13px] text-af2-ink-3">Loading versions…</p>
          )}
          {error && !loading && (
            <div className="rounded-2xl border border-af2-clay/40 bg-af2-clay/10 px-3 py-2 text-[13px] text-af2-clay">
              {error}
            </div>
          )}
          {!loading && !error && diff && (
            <div className="space-y-5">
              <div className="text-[12.5px] text-af2-ink-3">
                Step-level diff. Order of steps in the canvas isn't
                surfaced here; rename / kind / description / I/O key
                changes count as <em>changed</em>.
              </div>
              <DiffSection
                title="Added in current"
                tone="sage"
                items={diff.added.map((s) => `${s.name} (${s.kind})`)}
                empty="No new steps."
              />
              <DiffSection
                title="Removed since this version"
                tone="clay"
                items={diff.removed.map((s) => `${s.name} (${s.kind})`)}
                empty="No removed steps."
              />
              <DiffSection
                title="Changed"
                tone="mustard"
                items={diff.changed.map(
                  (c) => `${c.name} (${c.kind}) — ${c.what}`,
                )}
                empty="No edited steps."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DiffSection({
  title,
  tone,
  items,
  empty,
}: {
  title: string;
  tone: "sage" | "clay" | "mustard";
  items: string[];
  empty: string;
}) {
  const pillClass =
    tone === "sage"
      ? "af2-pill-live"
      : tone === "clay"
        ? "af2-pill-clay"
        : "af2-pill-pending";
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-af2-sans text-[13px] font-semibold text-af2-ink">
          {title}
        </h3>
        <span className={`af2-pill ${pillClass}`}>
          <span className="af2-dot" />
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] text-af2-ink-3">{empty}</p>
      ) : (
        <ul className="space-y-1" role="list">
          {items.map((label, i) => (
            <li
              key={`${title}-${i}`}
              className="rounded-md border border-af2-line bg-af2-paper-2 px-3 py-2 text-[12.5px] text-af2-ink"
            >
              {label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Step-level diff: structural compare of two dag.steps arrays by id.
// Returns added/removed/changed groups. "Changed" reasons are listed
// in a compact `what` string so the panel can show a short summary
// without expanding into a full property tree.
interface StepDiffSummary {
  added: { id: string; name: string; kind: string }[];
  removed: { id: string; name: string; kind: string }[];
  changed: { id: string; name: string; kind: string; what: string }[];
}

interface DiffStep {
  id: string;
  name: string;
  kind: string;
  description?: string;
  inputKeys?: string[];
  outputKeys?: string[];
}

// HEL-100 v2 restore-and-reload: merge an immutable dag blob (from a
// workflow_versions row) back into the editor's template state. Keeps
// the active template's id pinned (legacy template ID stays stable
// across versions, but defending against weird older dags is cheap),
// and reads the dag's structural fields with safe fallbacks so we
// never crash on a malformed payload.
function applyDagToTemplate(
  current: WorkflowTemplate,
  dag: unknown,
): WorkflowTemplate {
  if (!dag || typeof dag !== "object") return current;
  const blob = dag as Record<string, unknown>;
  const dagSteps = Array.isArray(blob.steps) ? (blob.steps as WorkflowStep[]) : current.steps;
  return {
    ...current,
    name: typeof blob.name === "string" ? blob.name : current.name,
    description:
      typeof blob.description === "string" ? blob.description : current.description,
    category:
      typeof blob.category === "string"
        ? (blob.category as WorkflowTemplate["category"])
        : current.category,
    version: typeof blob.version === "string" ? blob.version : current.version,
    configFields: Array.isArray(blob.configFields)
      ? (blob.configFields as WorkflowTemplate["configFields"])
      : current.configFields,
    steps: dagSteps,
    sampleInput:
      blob.sampleInput && typeof blob.sampleInput === "object"
        ? (blob.sampleInput as Record<string, unknown>)
        : current.sampleInput,
    expectedOutput:
      blob.expectedOutput && typeof blob.expectedOutput === "object"
        ? (blob.expectedOutput as Record<string, unknown>)
        : current.expectedOutput,
  };
}

function extractSteps(dag: unknown): DiffStep[] {
  if (!dag || typeof dag !== "object") return [];
  const stepsAny = (dag as { steps?: unknown }).steps;
  if (!Array.isArray(stepsAny)) return [];
  return stepsAny
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
    .map((s) => ({
      id: String(s.id ?? ""),
      name: typeof s.name === "string" ? s.name : "",
      kind: typeof s.kind === "string" ? s.kind : "",
      description: typeof s.description === "string" ? s.description : undefined,
      inputKeys: Array.isArray(s.inputKeys)
        ? s.inputKeys.filter((k): k is string => typeof k === "string")
        : undefined,
      outputKeys: Array.isArray(s.outputKeys)
        ? s.outputKeys.filter((k): k is string => typeof k === "string")
        : undefined,
    }))
    .filter((s) => s.id !== "");
}

function computeStepDiff(
  target: DiffStep[],
  latest: DiffStep[],
): StepDiffSummary {
  const targetById = new Map(target.map((s) => [s.id, s]));
  const latestById = new Map(latest.map((s) => [s.id, s]));

  const added: StepDiffSummary["added"] = [];
  const removed: StepDiffSummary["removed"] = [];
  const changed: StepDiffSummary["changed"] = [];

  for (const step of latest) {
    if (!targetById.has(step.id)) {
      added.push({ id: step.id, name: step.name, kind: step.kind });
    }
  }
  for (const step of target) {
    if (!latestById.has(step.id)) {
      removed.push({ id: step.id, name: step.name, kind: step.kind });
    }
  }
  for (const t of target) {
    const l = latestById.get(t.id);
    if (!l) continue;
    const reasons: string[] = [];
    if (t.name !== l.name) reasons.push("name");
    if (t.kind !== l.kind) reasons.push("kind");
    if ((t.description ?? "") !== (l.description ?? "")) reasons.push("description");
    if (!arraysEqual(t.inputKeys ?? [], l.inputKeys ?? [])) reasons.push("inputs");
    if (!arraysEqual(t.outputKeys ?? [], l.outputKeys ?? [])) reasons.push("outputs");
    if (reasons.length > 0) {
      changed.push({
        id: l.id,
        name: l.name,
        kind: l.kind,
        what: reasons.join(", "),
      });
    }
  }
  return { added, removed, changed };
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function formatVersionTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// HEL-100 v2 Pro inspector — Observability panel stub. Real metrics
// (p99 latency, cost/run, recent errors) are derived from the same
// runHistory the canvas run-history strip uses — runs come from
// GET /api/runs?templateId=X (RLS-scoped via workspaceResolver) and
// already include stepResults with costLog.estimatedCostUsd, so this
// panel doesn't need a separate fetch.
function ObservabilityPanel({ runs }: { runs: WorkflowRun[] }) {
  const durationsMs = runs.flatMap((run) => {
    if (run.status !== "completed" || !run.completedAt) return [];
    const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
    return ms > 0 && Number.isFinite(ms) ? [ms] : [];
  });
  const completedRunCostsUsd = runs
    .filter((run) => run.status === "completed")
    .map(sumRunCostUsd)
    .filter((cost): cost is number => cost !== null);

  const recentErrors = runs
    .filter((run) => run.status === "failed")
    .slice(0, 5);

  return (
    <div
      id="pro-inspector-panel-observability"
      role="tabpanel"
      className="p-5 space-y-4"
    >
      <div>
        <div className="af2-eyebrow">Latency · p99</div>
        {durationsMs.length === 0 ? (
          <p className="mt-2 text-[12px] text-af2-ink-3">
            No completed runs yet. p99 will roll up here once this
            workflow has been deployed and invoked.
          </p>
        ) : (
          <div className="af2-card mt-2 flex gap-4 p-3">
            <ObservabilityStat
              label="p50"
              value={formatRunMs(percentile(durationsMs, 50))}
            />
            <ObservabilityStat
              label="p99"
              value={formatRunMs(percentile(durationsMs, 99))}
            />
            <ObservabilityStat
              label="runs"
              value={String(durationsMs.length)}
            />
          </div>
        )}
      </div>
      <div>
        <div className="af2-eyebrow">Cost · per run</div>
        <div className="af2-card mt-2 flex gap-4 p-3">
          <ObservabilityStat
            label="median"
            value={
              completedRunCostsUsd.length > 0
                ? formatUsd(percentile(completedRunCostsUsd, 50))
                : "—"
            }
          />
          <ObservabilityStat
            label="p99"
            value={
              completedRunCostsUsd.length > 0
                ? formatUsd(percentile(completedRunCostsUsd, 99))
                : "—"
            }
          />
        </div>
        {completedRunCostsUsd.length === 0 && (
          <p className="mt-2 text-[11px] text-af2-ink-4">
            Cost telemetry is captured per step; values fill in once LLM
            or tool steps run.
          </p>
        )}
      </div>
      <div>
        <div className="af2-eyebrow">Recent errors</div>
        {recentErrors.length === 0 ? (
          <p className="mt-2 text-[12px] text-af2-ink-3">
            No failures recorded across the last {runs.length || 30} runs.
          </p>
        ) : (
          <ul className="mt-2 space-y-2" role="list">
            {recentErrors.map((run) => (
              <li
                key={run.id}
                className="af2-card flex items-start gap-3 p-3"
              >
                <span className="font-af2-mono text-[11px] text-af2-ink-3">
                  {formatVersionTimestamp(run.startedAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-af2-clay">
                  {run.error ?? "Run failed"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ObservabilityStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-af2-serif text-[20px] text-af2-ink">{value}</div>
      <div className="text-[11px] text-af2-ink-4">{label}</div>
    </div>
  );
}

// Sum the step-level estimatedCostUsd to get the run's total cost.
// Returns null if no step reported cost telemetry (so the caller can
// distinguish "$0" from "unknown").
function sumRunCostUsd(run: WorkflowRun): number | null {
  let total = 0;
  let any = false;
  for (const step of run.stepResults) {
    const cost = step.costLog?.estimatedCostUsd;
    if (typeof cost === "number" && Number.isFinite(cost)) {
      total += cost;
      any = true;
    }
  }
  return any ? total : null;
}

function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "—";
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  if (usd === 0) return "$0.00";
  return `$${usd.toFixed(4)}`;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-af2-ink-3 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function DeployAsTeamModal({
  template,
  busy,
  onClose,
  onDeploy,
}: {
  template: WorkflowTemplate;
  busy: boolean;
  onClose: () => void;
  onDeploy: (input: {
    teamName: string;
    budgetMonthlyUsd?: number;
    defaultIntervalMinutes?: number;
  }) => Promise<void>;
}) {
  const actionableSteps = template.steps.filter(
    (step) => !["trigger", "output", "file_trigger"].includes(step.kind)
  );
  const [teamName, setTeamName] = useState(`${template.name} Team`);
  const [budgetMonthlyUsd, setBudgetMonthlyUsd] = useState(120);
  const [defaultIntervalMinutes, setDefaultIntervalMinutes] = useState(30);

  // HEL-100 v2: DeployAsTeamModal restyle. Drops the slate-* + bg-white
  // chrome for af2 tokens (paper / card / ink / line) so the modal
  // matches the rest of the v2 paper aesthetic. Behaviour and layout
  // unchanged.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-af2-ink/55 backdrop-blur-[2px] px-4">
      <div className="af2-card max-h-[90vh] w-full max-w-4xl overflow-hidden shadow-af2-lg">
        <div className="flex items-center justify-between border-b border-af2-line px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-sage">
              Deploy as Team
            </p>
            <h2 className="font-af2-serif mt-1 text-xl font-medium text-af2-ink">
              Promote this workflow into a live agent roster
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close deploy as team dialog"
            className="rounded-full border border-af2-line p-2 text-af2-ink-3 transition hover:border-af2-line-2 hover:bg-af2-paper-2 hover:text-af2-ink"
            disabled={busy}
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="border-b border-af2-line p-6 lg:border-b-0 lg:border-r">
            <div className="mb-5">
              <h3 className="af2-eyebrow">Team preview</h3>
              <p className="mt-2 text-sm text-af2-ink-3">
                The manager owns orchestration, then actionable workflow steps become worker agents.
              </p>
            </div>

            <div className="space-y-3">
              <div className="rounded-md border border-af2-clay/30 bg-af2-clay/10 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-af2-clay text-white">
                    <Bot size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-af2-ink">
                      {template.name} Manager
                    </p>
                    <p className="text-xs uppercase tracking-[0.16em] text-af2-clay">
                      workflow-manager
                    </p>
                  </div>
                </div>
              </div>

              {actionableSteps.map((step, index) => (
                <div
                  key={step.id}
                  className="rounded-md border border-af2-line bg-af2-paper-2 px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-af2-ink">
                        {step.name}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-af2-ink-4">
                        {step.agentRoleKey ?? `${step.kind}-${index + 1}`}
                      </p>
                    </div>
                    <span className="rounded-full border border-af2-line bg-af2-card px-3 py-1 text-xs font-semibold text-af2-ink-2 shadow-sm">
                      {step.agentScheduleType === "interval"
                        ? `${step.agentScheduleValue || defaultIntervalMinutes} min`
                        : step.agentScheduleType === "cron"
                        ? step.agentScheduleValue || "cron"
                        : "manual"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-af2-line bg-af2-card px-3 py-1 text-xs font-medium text-af2-ink-2">
                      {step.agentModel ?? step.llmConfigId ?? "Default model"}
                    </span>
                    <span className="rounded-full border border-af2-line bg-af2-card px-3 py-1 text-xs font-medium text-af2-ink-2">
                      ${step.agentBudgetMonthlyUsd ?? 0}/mo
                    </span>
                    {(step.agentSkills ?? []).slice(0, 3).map((skill) => (
                      <span
                        key={skill}
                        className="rounded-full border border-af2-sage/30 bg-af2-sage/10 px-3 py-1 text-xs font-medium text-af2-sage"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form
            className="space-y-5 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void onDeploy({
                teamName,
                budgetMonthlyUsd,
                defaultIntervalMinutes,
              });
            }}
          >
            <div>
              <h3 className="af2-eyebrow">Launch settings</h3>
              <p className="mt-2 text-sm text-af2-ink-3">
                Pick a name, a monthly budget cap, and the default schedule cadence for new worker agents.
              </p>
            </div>

            <Field label="Team Name">
              <input
                className="w-full rounded-xl border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
              />
            </Field>

            <Field label="Monthly Team Budget (USD)">
              <input
                type="number"
                min={0}
                step="10"
                className="w-full rounded-xl border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                value={budgetMonthlyUsd}
                onChange={(event) => setBudgetMonthlyUsd(Number(event.target.value) || 0)}
              />
            </Field>

            <Field label="Default Interval Minutes">
              <input
                type="number"
                min={1}
                className="w-full rounded-xl border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
                value={defaultIntervalMinutes}
                onChange={(event) => setDefaultIntervalMinutes(Number(event.target.value) || 1)}
              />
            </Field>

            <div className="rounded-md border border-af2-mustard/30 bg-af2-mustard/10 px-4 py-3 text-sm text-af2-mustard">
              Deploying creates a control-plane team and agent roster. Start/stop lifecycle controls are not exposed by the current backend yet, so monitoring and task handoff are the primary post-deploy actions available in this release.
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                aria-label="Cancel agent team deployment"
                className="rounded-full border border-af2-line-2 px-4 py-2 text-sm font-medium text-af2-ink-2 transition hover:bg-af2-paper-2 hover:text-af2-ink"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                aria-label="Confirm agent team deployment"
                className="inline-flex items-center gap-2 rounded-full bg-af2-sage px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-af2-sage-2 disabled:opacity-60"
              >
                {busy ? <Loader size={15} className="animate-spin" /> : <Send size={15} />}
                Confirm deployment
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileUploadModal — triggered when the workflow has a file_trigger step
// ---------------------------------------------------------------------------

type UploadState = "idle" | "uploading" | "done" | "error";

function FileUploadModal({
  templateId,
  acceptedFileTypes,
  onClose,
  onStarted,
}: {
  templateId: string;
  acceptedFileTypes: string[];
  onClose: () => void;
  onStarted: () => void;
}) {
  const { getAccessToken } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const acceptAttr = acceptedFileTypes.length > 0 ? acceptedFileTypes.join(",") : undefined;

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }

  async function handleSubmit() {
    if (!file) return;
    setState("uploading");
    setErrorMsg(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      await startRunWithFile(templateId, file, undefined, accessToken);
      setState("done");
      setTimeout(onStarted, 800);
    } catch (e) {
      setState("error");
      setErrorMsg(e instanceof Error ? e.message : "Upload failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-af2-card rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-af2-line">
          <div className="flex items-center gap-2">
            <UploadCloud size={18} className="text-af2-clay" />
            <h2 className="font-semibold text-af2-ink">Upload File to Run Workflow</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-af2-paper-2" disabled={state === "uploading"}>
            <X size={16} className="text-af2-ink-3" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={clsx(
              "relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition",
              dragOver ? "border-af2-clay/40 bg-af2-clay-soft/30" : "border-af2-line-2 hover:border-af2-clay/30 hover:bg-af2-paper-2"
            )}
            onClick={() => document.getElementById("file-upload-input")?.click()}
          >
            <input
              id="file-upload-input"
              type="file"
              className="hidden"
              accept={acceptAttr}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }}
            />
            <UploadCloud size={32} className={dragOver ? "text-af2-clay" : "text-af2-ink-4"} />
            <div>
              <p className="text-sm font-medium text-af2-ink-2">
                {file ? file.name : "Drop a file here, or click to browse"}
              </p>
              {acceptedFileTypes.length > 0 && (
                <p className="text-xs text-af2-ink-4 mt-1">
                  Accepted: {acceptedFileTypes.join(", ")}
                </p>
              )}
              {file && (
                <p className="text-xs text-af2-ink-4 mt-1">
                  {(file.size / 1024).toFixed(1)} KB · {file.type || "unknown type"}
                </p>
              )}
            </div>
          </div>

          {/* Status */}
          {state === "error" && errorMsg && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-af2-clay-soft/30 border border-af2-clay/30 text-sm text-af2-clay">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          )}
          {state === "done" && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-af2-sage/10 border border-af2-sage/30 text-sm text-af2-sage">
              <CheckCircle2 size={15} className="shrink-0" />
              Run started — redirecting to monitor…
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={state === "uploading" || state === "done"}
              className="flex-1 py-2.5 rounded-lg border border-af2-line text-af2-ink-3 hover:bg-af2-paper-2 text-sm font-medium transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!file || state === "uploading" || state === "done"}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-af2-clay hover:bg-af2-clay-2 text-white text-sm font-medium transition disabled:opacity-50"
            >
              {state === "uploading" ? (
                <>
                  <Loader size={14} className="animate-spin" />
                  Uploading & parsing…
                </>
              ) : (
                <>
                  <UploadCloud size={14} />
                  Run with File
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
