import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
  Sparkles,
  Loader,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  CircleHelp,
} from "lucide-react";
import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type XYPosition,
} from "@xyflow/react";
import clsx from "clsx";
import { getTemplate, listTemplates, startRun, startRunWithFile, listLLMConfigs, generateWorkflow, createTemplate, type TemplateSummary, type LLMConfig } from "../api/client";
import { Tooltip } from "../components/Tooltip";
import { ErrorState, LoadingState } from "../components/UiStates";
import type { WorkflowStep, StepKind, WorkflowTemplate } from "../types/workflow";
import {
  buildDefaultEdge,
  buildEdgesFromSteps,
  serializeEdgesToSteps,
  STEP_POSITION_KEY,
  validateEdgeCandidate,
  validateGraphTopology,
} from "./workflowGraph";
import { useTheme } from "../hooks/useTheme";

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
    chipColor: "text-emerald-700 dark:text-emerald-400",
    chipBg: "bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30",
    categoryTint: "rgba(16,185,129,0.12)",
    darkCategoryTint: "rgba(16,185,129,0.18)",
    categoryBorder: "#10b981",
  },
  llm: {
    label: "LLM",
    icon: <Brain size={14} />,
    chipColor: "text-brand-700 dark:text-brand-300",
    chipBg: "bg-brand-50 border-brand-200 dark:bg-brand-500/10 dark:border-brand-500/30",
    categoryTint: "rgba(99,102,241,0.12)",
    darkCategoryTint: "rgba(99,102,241,0.18)",
    categoryBorder: "#6366f1",
  },
  condition: {
    label: "Condition",
    icon: <GitBranch size={14} />,
    chipColor: "text-amber-700 dark:text-amber-400",
    chipBg: "bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30",
    categoryTint: "rgba(245,158,11,0.12)",
    darkCategoryTint: "rgba(245,158,11,0.18)",
    categoryBorder: "#f59e0b",
  },
  transform: {
    label: "Transform",
    icon: <Wrench size={14} />,
    chipColor: "text-brand-700 dark:text-brand-300",
    chipBg: "bg-brand-50 border-brand-200 dark:bg-brand-500/10 dark:border-brand-500/30",
    categoryTint: "rgba(99,102,241,0.12)",
    darkCategoryTint: "rgba(99,102,241,0.18)",
    categoryBorder: "#6366f1",
  },
  action: {
    label: "Action",
    icon: <ArrowRight size={14} />,
    chipColor: "text-brand-700 dark:text-brand-300",
    chipBg: "bg-brand-50 border-brand-200 dark:bg-brand-500/10 dark:border-brand-500/30",
    categoryTint: "rgba(99,102,241,0.12)",
    darkCategoryTint: "rgba(99,102,241,0.18)",
    categoryBorder: "#6366f1",
  },
  output: {
    label: "Output",
    icon: <Flag size={14} />,
    chipColor: "text-brand-700 dark:text-brand-300",
    chipBg: "bg-brand-50 border-brand-200 dark:bg-brand-500/10 dark:border-brand-500/30",
    categoryTint: "rgba(99,102,241,0.12)",
    darkCategoryTint: "rgba(99,102,241,0.18)",
    categoryBorder: "#6366f1",
  },
  agent: {
    label: "Agent",
    icon: <Bot size={14} />,
    chipColor: "text-brand-700 dark:text-brand-300",
    chipBg: "bg-brand-50 border-brand-200 dark:bg-brand-500/10 dark:border-brand-500/30",
    categoryTint: "rgba(99,102,241,0.12)",
    darkCategoryTint: "rgba(99,102,241,0.18)",
    categoryBorder: "#6366f1",
  },
  approval: {
    label: "Approval",
    icon: <UserCheck size={14} />,
    chipColor: "text-brand-700 dark:text-brand-300",
    chipBg: "bg-brand-50 border-brand-200 dark:bg-brand-500/10 dark:border-brand-500/30",
    categoryTint: "rgba(99,102,241,0.12)",
    darkCategoryTint: "rgba(99,102,241,0.18)",
    categoryBorder: "#6366f1",
  },
  mcp: {
    label: "Integration",
    icon: <Plug size={14} />,
    chipColor: "text-sky-700 dark:text-sky-400",
    chipBg: "bg-sky-50 border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/30",
    categoryTint: "rgba(14,165,233,0.12)",
    darkCategoryTint: "rgba(14,165,233,0.18)",
    categoryBorder: "#0ea5e9",
  },
  file_trigger: {
    label: "File Trigger",
    icon: <FileInput size={14} />,
    chipColor: "text-emerald-700 dark:text-emerald-400",
    chipBg: "bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30",
    categoryTint: "rgba(16,185,129,0.12)",
    darkCategoryTint: "rgba(16,185,129,0.18)",
    categoryBorder: "#10b981",
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

const FLOW_STEP_X = 80;
const FLOW_STEP_Y = 64;
const FLOW_STEP_GAP_Y = 190;

type FlowNodeData = {
  step: WorkflowStep;
  onSelect: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onRemove: (id: string) => void;
  isFirst: boolean;
  isLast: boolean;
};

type WorkflowFlowNode = Node<FlowNodeData, "workflowStep">;

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
  const { theme } = useTheme();

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

  const hasFileTrigger = template.steps.some((s) => s.kind === "file_trigger");
  const fileTriggerStep = template.steps.find((s) => s.kind === "file_trigger");

  useEffect(() => {
    listTemplates()
      .then(setAllTemplates)
      .catch((e) => setTemplatesError(e instanceof Error ? e.message : "Failed to load templates"));
  }, []);

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
  }, [templateId]);

  const selectedStep = template.steps.find((s) => s.id === selectedStepId) ?? null;
  const isLlmStep = selectedStep?.kind === "llm";

  useEffect(() => {
    if (!isLlmStep) return;
    setLlmConfigsLoading(true);
    setLlmConfigsError(null);
    listLLMConfigs()
      .then(setLlmConfigs)
      .catch((e) => setLlmConfigsError(e instanceof Error ? e.message : "Failed to load providers"))
      .finally(() => setLlmConfigsLoading(false));
  }, [isLlmStep]);

  function addStep(kind: StepKind) {
    const newStepId = "step-" + Date.now();
    let autoLinkError: string | null = null;
    setTemplate((t) => {
      const nextIndex = t.steps.length;
      const defaultPosition = {
        x: FLOW_STEP_X,
        y: FLOW_STEP_Y + nextIndex * FLOW_STEP_GAP_Y,
      };
      const newStep: WorkflowStep = {
        id: newStepId,
        name: KIND_META[kind].label + " Step",
        kind,
        description: "",
        inputKeys: [],
        outputKeys: [],
        config: {
          [STEP_POSITION_KEY]: defaultPosition,
        },
      };
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

  const flowNodes: WorkflowFlowNode[] = template.steps.map((step, idx) => ({
    id: step.id,
    type: "workflowStep",
    position: readStepPosition(step, idx),
    draggable: true,
    selectable: true,
    data: {
      step,
      onSelect: setSelectedStepId,
      onMoveUp: (stepId) => moveStep(stepId, -1),
      onMoveDown: (stepId) => moveStep(stepId, 1),
      onRemove: removeStep,
      isFirst: idx === 0,
      isLast: idx === template.steps.length - 1,
    },
  }));

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
      });
      setTemplate(nextTemplate);
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
      await startRun(template.id, template.sampleInput);
      navigate("/monitor");
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Failed to start run");
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
      {/* Left panel — canvas */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {runError && (
          <div className="px-6 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
            {runError}
          </div>
        )}
        {templatesError && (
          <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-800">
            {templatesError}
          </div>
        )}
        {saveError && (
          <div className="px-6 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
            {saveError}
          </div>
        )}
        {graphError && (
          <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-800">
            {graphError}
          </div>
        )}
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white dark:bg-surface-900 border-b border-gray-200 dark:border-surface-800">
          <div className="flex items-center gap-3">
            <input
              className="text-lg font-semibold text-gray-900 dark:text-gray-100 bg-transparent border-none outline-none focus:ring-2 focus:ring-brand-500 rounded px-1 -ml-1"
              value={template.name}
              onChange={(e) => setTemplate((t) => ({ ...t, name: e.target.value }))}
            />
            <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-surface-800 text-gray-500 dark:text-surface-400 rounded-full capitalize">
              {template.category}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip content="Open setup guidance and best practices for this page">
              <button
                onClick={() => setShowHelp(true)}
                className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-surface-700 text-gray-700 dark:text-gray-200 bg-white dark:bg-surface-800 hover:bg-gray-50 dark:hover:bg-surface-700 transition"
              >
                <CircleHelp size={15} />
                Guidance
              </button>
            </Tooltip>
            <button
              onClick={() => setShowNLModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg border border-purple-300 dark:border-purple-500/30 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10 hover:bg-purple-100 dark:hover:bg-purple-500/20 transition"
            >
              <Sparkles size={15} />
              Generate with AI
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className={clsx(
                "flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg border transition disabled:opacity-50",
                saved
                  ? "bg-green-50 dark:bg-green-500/10 border-green-300 dark:border-green-500/30 text-green-700 dark:text-green-300"
                  : "border-gray-300 dark:border-surface-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-surface-700"
              )}
            >
              {saving ? <Loader size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? "Saving..." : saved ? "Saved!" : "Save"}
            </button>
            <button
              onClick={handleRun}
              disabled={template.steps.length === 0}
              className="flex items-center gap-2 px-3.5 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
            >
              <Play size={15} />
              Run
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative flex-1 overflow-hidden bg-slate-50 dark:bg-surface-950">
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
                onNodeClick={(_, node) => setSelectedStepId(node.id)}
                onPaneClick={() => setSelectedStepId(null)}
                onConnect={handleConnect}
                onEdgesDelete={(deletedEdges) => {
                  if (deletedEdges.length === 0) return;
                  const deletedIds = new Set(deletedEdges.map((edge) => edge.id));
                  persistEdges(flowEdges.filter((edge) => !deletedIds.has(edge.id)));
                  setGraphError(null);
                }}
                onNodeDragStop={(_, node) => {
                  updateStepPosition(node.id, node.position);
                }}
              >
                <Background variant={BackgroundVariant.Dots} gap={20} size={2} color={theme === "dark" ? "#1e293b" : "#cbd5e1"} />
                <Controls
                  position="bottom-right"
                  showInteractive={false}
                  className="workflow-controls-pill"
                />
              </ReactFlow>
              <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
                <div className="pointer-events-auto rounded-full border border-slate-200 dark:border-surface-700 bg-white/95 dark:bg-surface-800/95 px-2 py-1.5 shadow-md backdrop-blur">
                  <AddStepMenu onAdd={addStep} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right panel — step detail */}
      {selectedStep && (
        <div className="absolute right-0 top-0 z-20 h-full w-[360px] overflow-y-auto border-l border-gray-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-xl transition-transform duration-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-surface-800">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Step Properties</h3>
            <button
              onClick={() => setSelectedStepId(null)}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-surface-800"
            >
              <X size={16} className="text-gray-500" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            <Field label="Name">
              <input
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-surface-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-surface-800 text-gray-900 dark:text-gray-100"
                value={selectedStep.name}
                onChange={(e) => updateStep(selectedStep.id, { name: e.target.value })}
              />
            </Field>

            <Field label="Kind">
              <select
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-surface-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-surface-800 text-gray-900 dark:text-gray-100"
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
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-surface-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none bg-white dark:bg-surface-800 text-gray-900 dark:text-gray-100"
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
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono text-xs"
                  rows={5}
                  placeholder="Use {{key}} for variable interpolation"
                  value={selectedStep.promptTemplate ?? ""}
                  onChange={(e) =>
                    updateStep(selectedStep.id, { promptTemplate: e.target.value })
                  }
                />
              </Field>
            )}

            {selectedStep.kind === "llm" && (
              <Field label="LLM Provider">
                {llmConfigsLoading ? (
                  <div className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-400 bg-gray-50">
                    Loading providers…
                  </div>
                ) : llmConfigsError ? (
                  <p className="text-xs text-red-600">{llmConfigsError}</p>
                ) : llmConfigs.length === 0 ? (
                  <div className="px-3 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-700 leading-relaxed">
                    No LLM providers connected.{" "}
                    <a href="/settings/llm-providers" className="underline font-medium hover:text-amber-900">
                      Go to Settings
                    </a>{" "}
                    to add one.
                  </div>
                ) : (
                  <select
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
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
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
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
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
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
                <Field label="Model">
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. claude-sonnet-4-6"
                    value={selectedStep.agentModel ?? ""}
                    onChange={(e) =>
                      updateStep(selectedStep.id, { agentModel: e.target.value })
                    }
                  />
                </Field>
                <Field label="Instructions">
                  <textarea
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    rows={4}
                    placeholder="System instructions for this agent…"
                    value={selectedStep.agentInstructions ?? ""}
                    onChange={(e) =>
                      updateStep(selectedStep.id, { agentInstructions: e.target.value })
                    }
                  />
                </Field>
                <Field label="Parallel Worker Slots">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. manager@company.com"
                    value={selectedStep.approvalAssignee ?? ""}
                    onChange={(e) =>
                      updateStep(selectedStep.id, { approvalAssignee: e.target.value })
                    }
                  />
                </Field>
                <Field label="Approval Request Message">
                  <textarea
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="60"
                    value={selectedStep.approvalTimeoutMinutes ?? 60}
                    onChange={(e) =>
                      updateStep(selectedStep.id, {
                        approvalTimeoutMinutes: parseInt(e.target.value, 10) || 60,
                      })
                    }
                  />
                </Field>
                <div className="px-3 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-700 leading-relaxed">
                  Workflow will pause at this step until the assignee approves or rejects. On timeout, the workflow escalates or continues based on your escalation policy.
                </div>
              </>
            )}

            {selectedStep.kind === "mcp" && (
              <>
                <Field label="Integration Server URL">
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    placeholder="https://mcp.example.com/sse"
                    value={selectedStep.mcpServerUrl ?? ""}
                    onChange={(e) =>
                      updateStep(selectedStep.id, { mcpServerUrl: e.target.value })
                    }
                  />
                </Field>
                <Field label="Tool Name">
                  <input
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
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
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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

      {showHelp && <WorkflowBuilderHelpPanel onClose={() => setShowHelp(false)} />}
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
    <div className="fixed inset-0 z-50 flex justify-end bg-gray-950/35">
      <button className="flex-1" onClick={onClose} aria-label="Close guidance" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Workflow guidance"
        className="w-full max-w-md overflow-y-auto border-l border-gray-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 shadow-xl"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Workflow help</p>
            <h2 className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">Build and launch confidently</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100 dark:hover:bg-surface-800 hover:text-gray-800 dark:hover:text-gray-200"
            aria-label="Close guidance panel"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
          <section className="rounded-lg border border-gray-200 dark:border-surface-800 bg-gray-50 dark:bg-surface-800/50 p-4">
            <h3 className="font-medium text-gray-900 dark:text-gray-100">Suggested flow</h3>
            <p className="mt-1">Trigger -&gt; LLM -&gt; Condition/Transform -&gt; Action -&gt; Output.</p>
          </section>

          <section className="rounded-lg border border-gray-200 dark:border-surface-800 p-4">
            <h3 className="font-medium text-gray-900 dark:text-gray-100">High-impact tips</h3>
            <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-400">
              <li>Use clear step names so run logs are easy to debug.</li>
              <li>Define input/output keys on each step to avoid brittle data passing.</li>
              <li>Connect an LLM provider before testing any LLM step.</li>
            </ul>
          </section>

          <section className="rounded-lg border border-gray-200 dark:border-surface-800 p-4">
            <h3 className="font-medium text-gray-900 dark:text-gray-100">When runs fail</h3>
            <ul className="mt-2 space-y-1 text-gray-600 dark:text-gray-400">
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
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<WorkflowStep[] | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const steps = await generateWorkflow(prompt.trim());
      setPreview(steps);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-surface-800">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-purple-500" />
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Generate Workflow with AI</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-surface-800">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-surface-400 mb-1.5">
              Describe your workflow
            </label>
            <textarea
              className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-surface-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white dark:bg-surface-800 text-gray-900 dark:text-gray-100 resize-none"
              rows={4}
              placeholder="e.g. When a customer support email arrives, classify its intent, check if it's urgent, and send an automated reply or escalate to a human agent…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={generating}
            />
          </div>

          {generateError && (
            <p className="text-xs text-red-600">{generateError}</p>
          )}

          {!preview && (
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || generating}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition disabled:opacity-50"
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
                <p className="text-xs font-medium text-gray-600 dark:text-surface-400 mb-2">
                  Preview — {preview.length} steps suggested
                </p>
                <div className="rounded-xl border border-gray-200 dark:border-surface-800 divide-y divide-gray-100 dark:divide-surface-800 overflow-hidden">
                  {preview.map((step, i) => {
                    const meta = KIND_META[step.kind];
                    return (
                      <div key={step.id} className="flex items-center gap-3 px-4 py-2.5 text-sm bg-white dark:bg-surface-900">
                        <span className="text-gray-300 dark:text-surface-600 text-xs w-4">{i + 1}</span>
                        <span className={clsx("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border", meta.chipBg, meta.chipColor)}>
                          {meta.icon}
                          {meta.label}
                        </span>
                        <span className="text-gray-800 dark:text-gray-200 font-medium flex-1">{step.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => onApply(preview)}
                  className="flex-1 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition"
                >
                  Apply to Canvas
                </button>
                <button
                  onClick={() => { setPreview(null); setPrompt(""); }}
                  className="px-4 py-2.5 rounded-lg border border-gray-200 dark:border-surface-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-800 text-sm font-medium transition"
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
  const slotDefinitions = buildAgentSlotDefinitions(step);

  return (
    <div
      className="mt-4 rounded-[10px] border border-slate-700/80 bg-slate-950/70 p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Modular Attachments
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {Math.max(1, step.subAgentSlots ?? 1)} worker slot{(step.subAgentSlots ?? 1) === 1 ? "" : "s"} fan out from this agent.
          </p>
        </div>
        <div className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-300">
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
                "min-h-[98px] rounded-[10px] border p-3 transition-transform duration-150",
                isEmpty ? "border-dashed" : ""
              )}
              style={{
                borderColor: isEmpty ? slot.border : "rgba(51,65,85,0.96)",
                background: isEmpty
                  ? "rgba(15,23,42,0.38)"
                  : `linear-gradient(180deg, ${slot.tint} 0%, rgba(15,23,42,0.66) 100%)`,
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
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed text-slate-400"
                    style={{ borderColor: slot.border }}
                    aria-hidden="true"
                  >
                    <Plus size={12} />
                  </div>
                )}
              </div>

              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                {slot.label}
              </p>
              <p className={clsx("mt-2 text-sm font-medium", isEmpty ? "text-slate-500" : "text-slate-100")}>
                {slot.value ?? "Empty"}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-slate-400">
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
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-slate-500" />
      <StepNode
        step={data.step}
        selected={selected}
        dragging={dragging}
        onSelect={() => data.onSelect(id)}
        onMoveUp={() => data.onMoveUp(id)}
        onMoveDown={() => data.onMoveDown(id)}
        onRemove={() => data.onRemove(id)}
        isFirst={data.isFirst}
        isLast={data.isLast}
      />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-slate-500" />
    </div>
  );
}

function StepNode({
  step,
  selected,
  dragging,
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
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { theme } = useTheme();
  const meta = KIND_META[step.kind];
  const isAgentNode = step.kind === "agent";
  const visualState = readNodeVisualState(step);
  const showSuccessState = visualState === "success";
  const showErrorState = visualState === "error";
  const showRunningState = visualState === "running";

  return (
    <div
      onClick={onSelect}
      style={{ borderColor: selected ? "#6366f1" : undefined }}
      className={clsx(
        "group workflow-step-node relative cursor-pointer overflow-hidden rounded-[12px] border shadow-md transition-all",
        isAgentNode
          ? selected
            ? "border-2 border-brand-500 bg-slate-800 ring-2 ring-brand-500/20 shadow-[0_16px_34px_rgba(15,23,42,0.42)]"
            : "border border-slate-700 bg-slate-800 hover:border-brand-500 shadow-[0_14px_28px_rgba(15,23,42,0.36)]"
          : selected
            ? "border-2 border-brand-500 bg-white ring-2 ring-brand-500/20 dark:bg-surface-900"
            : "border border-gray-300 bg-white hover:border-brand-400 dark:border-surface-700 dark:bg-surface-900 dark:hover:border-brand-500/50",
        dragging ? "opacity-90 shadow-lg" : "",
        showRunningState ? "workflow-node-running" : "",
        showSuccessState ? "workflow-node-success" : "",
        showErrorState ? "workflow-node-error" : ""
      )}
    >
      <div
        className={clsx("h-10 border-b px-4", isAgentNode ? "border-slate-700 bg-slate-900/80" : "border-black/5 dark:border-white/5")}
        style={isAgentNode ? undefined : { backgroundColor: theme === "dark" ? meta.darkCategoryTint : meta.categoryTint }}
      >
        <div className={clsx("flex h-full items-center gap-2 text-xs font-medium", isAgentNode ? "text-slate-200" : "text-gray-700 dark:text-gray-300")}>
          <span style={{ color: meta.categoryBorder }}>{meta.icon}</span>
          {meta.label}
          {showRunningState && <Loader size={12} className="ml-auto animate-spin text-brand-500" />}
          {showSuccessState && <CheckCircle2 size={12} className="ml-auto text-emerald-600 dark:text-emerald-400" />}
          {showErrorState && <AlertCircle size={12} className="ml-auto text-rose-600 dark:text-rose-400" />}
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={clsx(
              "flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium mt-0.5",
              isAgentNode ? "border-brand-500/30 bg-brand-500/12 text-indigo-100" : meta.chipBg,
              isAgentNode ? "" : meta.chipColor
            )}
          >
            {meta.icon}
            {meta.label}
          </div>

          <div className="flex-1 min-w-0">
            <p className={clsx("text-sm font-medium", isAgentNode ? "text-slate-50" : "text-gray-900 dark:text-gray-100")}>{step.name}</p>
            {step.description && (
              <p className={clsx("mt-0.5 text-xs truncate", isAgentNode ? "text-slate-400" : "text-gray-500 dark:text-surface-400")}>
                {step.description}
              </p>
            )}
          </div>
        </div>

        {/* IO keys */}
        {(step.inputKeys.length > 0 || step.outputKeys.length > 0) && (
          <div className="flex gap-4 mt-3 text-xs">
            {step.inputKeys.length > 0 && (
              <div>
                <span className={clsx("mr-1", isAgentNode ? "text-slate-500" : "text-gray-400 dark:text-surface-500")}>in:</span>
                {step.inputKeys.map((k) => (
                  <span
                    key={k}
                    className={clsx(
                      "mr-1 rounded px-1.5 py-0.5",
                      isAgentNode
                        ? "bg-slate-900 text-slate-300"
                        : "bg-gray-100 text-gray-600 dark:bg-surface-800 dark:text-surface-300"
                    )}
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
            {step.outputKeys.length > 0 && (
              <div>
                <span className={clsx("mr-1", isAgentNode ? "text-slate-500" : "text-gray-400 dark:text-surface-500")}>out:</span>
                {step.outputKeys.map((k) => (
                  <span
                    key={k}
                    className={clsx(
                      "mr-1 rounded px-1.5 py-0.5",
                      isAgentNode
                        ? "bg-indigo-500/12 text-indigo-200"
                        : "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300"
                    )}
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
          <AgentSlots step={step} />
        )}
      </div>

      {/* Actions (show on hover) */}
      <div className="absolute right-3 top-3 hidden group-hover:flex items-center gap-1">
        {!isFirst && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-surface-800 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            title="Move step up"
            aria-label="Move step up"
          >
            <ChevronUp size={14} />
          </button>
        )}
        {!isLast && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-surface-800 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            title="Move step down"
            aria-label="Move step down"
          >
            <ChevronDown size={14} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"
          title="Delete step"
          aria-label="Delete step"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
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
            ? "border-brand-300 dark:border-brand-500/50 bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300"
            : "border-gray-300 dark:border-surface-700 text-gray-600 dark:text-gray-300 hover:border-brand-300 dark:hover:border-brand-500/50 hover:text-brand-700 dark:hover:text-brand-300"
        )}
      >
        <Plus size={16} /> Node Palette
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 z-10 w-56 -translate-x-1/2 rounded-2xl border border-gray-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-2 shadow-lg">
          {kinds.map(([kind, meta]) => (
            <button
              key={kind}
              onClick={() => { onAdd(kind); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded-lg hover:bg-gray-50 dark:hover:bg-surface-800 transition text-gray-700 dark:text-gray-300"
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

function EmptyCanvas({
  onAdd,
  templates,
}: {
  onAdd: (k: StepKind) => void;
  templates: TemplateSummary[];
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
      <div className="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-500/10 flex items-center justify-center mb-4">
        <Zap size={28} className="text-brand-500" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Start building your workflow</h3>
      <p className="text-gray-500 dark:text-surface-400 text-sm mb-6 max-w-xs">
        Add steps to compose your AI workflow. Each step passes data to the next.
      </p>
      <AddStepMenu onAdd={onAdd} />

      {templates.length > 0 && (
        <div className="mt-8">
          <p className="text-xs text-gray-400 dark:text-surface-500 mb-3">Or start from a template:</p>
          <div className="flex gap-2">
            {templates.map((t) => (
              <a
                key={t.id}
                href={`/builder/${t.id}`}
                className="px-3 py-1.5 bg-white dark:bg-surface-800 border border-gray-200 dark:border-surface-700 rounded-lg text-xs text-gray-600 dark:text-gray-300 hover:border-brand-400 dark:hover:border-brand-500/50 hover:text-brand-600 dark:hover:text-brand-300 transition"
              >
                {t.name}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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
      <label className="block text-xs font-medium text-gray-600 dark:text-surface-400 mb-1.5">{label}</label>
      {children}
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
      await startRunWithFile(templateId, file);
      setState("done");
      setTimeout(onStarted, 800);
    } catch (e) {
      setState("error");
      setErrorMsg(e instanceof Error ? e.message : "Upload failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-surface-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-surface-800">
          <div className="flex items-center gap-2">
            <UploadCloud size={18} className="text-rose-500" />
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Upload File to Run Workflow</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-surface-800" disabled={state === "uploading"}>
            <X size={16} className="text-gray-500" />
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
              dragOver ? "border-rose-400 bg-rose-50 dark:bg-rose-500/10" : "border-gray-300 dark:border-surface-700 hover:border-rose-300 hover:bg-gray-50 dark:hover:bg-surface-800"
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
            <UploadCloud size={32} className={dragOver ? "text-rose-400" : "text-gray-300 dark:text-surface-600"} />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {file ? file.name : "Drop a file here, or click to browse"}
              </p>
              {acceptedFileTypes.length > 0 && (
                <p className="text-xs text-gray-400 dark:text-surface-500 mt-1">
                  Accepted: {acceptedFileTypes.join(", ")}
                </p>
              )}
              {file && (
                <p className="text-xs text-gray-400 dark:text-surface-500 mt-1">
                  {(file.size / 1024).toFixed(1)} KB · {file.type || "unknown type"}
                </p>
              )}
            </div>
          </div>

          {/* Status */}
          {state === "error" && errorMsg && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-sm text-red-700 dark:text-red-300">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          )}
          {state === "done" && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 text-sm text-green-700 dark:text-green-300">
              <CheckCircle2 size={15} className="shrink-0" />
              Run started — redirecting to monitor…
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={state === "uploading" || state === "done"}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 dark:border-surface-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-800 text-sm font-medium transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!file || state === "uploading" || state === "done"}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition disabled:opacity-50"
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
