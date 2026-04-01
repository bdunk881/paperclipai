import { useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Plus,
  Play,
  Trash2,
  ChevronDown,
  ChevronUp,
  Zap,
  Brain,
  GitBranch,
  Wrench,
  ArrowRight,
  Flag,
  Save,
  X,
} from "lucide-react";
import { MOCK_TEMPLATES, MOCK_RUNS, generateRunId } from "../data/mockData";
import type { WorkflowStep, StepKind, WorkflowTemplate } from "../types/workflow";
import clsx from "clsx";

const KIND_META: Record<
  StepKind,
  { label: string; icon: React.ReactNode; color: string; bg: string }
> = {
  trigger: {
    label: "Trigger",
    icon: <Zap size={14} />,
    color: "text-blue-700",
    bg: "bg-blue-100 border-blue-300",
  },
  llm: {
    label: "LLM",
    icon: <Brain size={14} />,
    color: "text-purple-700",
    bg: "bg-purple-100 border-purple-300",
  },
  condition: {
    label: "Condition",
    icon: <GitBranch size={14} />,
    color: "text-yellow-700",
    bg: "bg-yellow-100 border-yellow-300",
  },
  transform: {
    label: "Transform",
    icon: <Wrench size={14} />,
    color: "text-orange-700",
    bg: "bg-orange-100 border-orange-300",
  },
  action: {
    label: "Action",
    icon: <ArrowRight size={14} />,
    color: "text-green-700",
    bg: "bg-green-100 border-green-300",
  },
  output: {
    label: "Output",
    icon: <Flag size={14} />,
    color: "text-gray-700",
    bg: "bg-gray-100 border-gray-300",
  },
};

export default function WorkflowBuilder() {
  const { templateId } = useParams<{ templateId?: string }>();
  const navigate = useNavigate();

  const baseTemplate = templateId
    ? MOCK_TEMPLATES.find((t) => t.id === templateId) ?? null
    : null;

  const [template, setTemplate] = useState<WorkflowTemplate>(
    baseTemplate ?? {
      id: "tpl-custom-" + Date.now(),
      name: "Untitled Workflow",
      description: "",
      category: "custom",
      version: "1.0.0",
      configFields: [],
      steps: [],
      sampleInput: {},
      expectedOutput: {},
    }
  );

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [showRunModal, setShowRunModal] = useState(false);
  const [saved, setSaved] = useState(false);

  const selectedStep = template.steps.find((s) => s.id === selectedStepId) ?? null;

  function addStep(kind: StepKind) {
    const newStep: WorkflowStep = {
      id: "step-" + Date.now(),
      name: KIND_META[kind].label + " Step",
      kind,
      description: "",
      inputKeys: [],
      outputKeys: [],
    };
    setTemplate((t) => ({ ...t, steps: [...t.steps, newStep] }));
    setSelectedStepId(newStep.id);
  }

  function updateStep(id: string, patch: Partial<WorkflowStep>) {
    setTemplate((t) => ({
      ...t,
      steps: t.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }

  function removeStep(id: string) {
    setTemplate((t) => ({ ...t, steps: t.steps.filter((s) => s.id !== id) }));
    if (selectedStepId === id) setSelectedStepId(null);
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

  function handleSave() {
    // TODO: POST /api/workflows
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleRun() {
    // Add a mock run and navigate to the monitor
    const run = {
      id: generateRunId(),
      templateId: template.id,
      templateName: template.name,
      status: "running" as const,
      startedAt: new Date().toISOString(),
      input: template.sampleInput,
      stepResults: template.steps.map((s, i) => ({
        stepId: s.id,
        stepName: s.name,
        status: (i === 0 ? "running" : "skipped") as "running" | "skipped",
        output: {},
        durationMs: 0,
      })),
    };
    MOCK_RUNS.unshift(run);
    navigate("/monitor");
  }

  return (
    <div className="flex h-full">
      {/* Left panel — canvas */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
          <div className="flex items-center gap-3">
            <input
              className="text-lg font-semibold text-gray-900 bg-transparent border-none outline-none focus:ring-2 focus:ring-blue-500 rounded px-1 -ml-1"
              value={template.name}
              onChange={(e) => setTemplate((t) => ({ ...t, name: e.target.value }))}
            />
            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full capitalize">
              {template.category}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className={clsx(
                "flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg border transition",
                saved
                  ? "bg-green-50 border-green-300 text-green-700"
                  : "border-gray-300 text-gray-700 hover:bg-gray-50"
              )}
            >
              <Save size={15} />
              {saved ? "Saved!" : "Save"}
            </button>
            <button
              onClick={handleRun}
              disabled={template.steps.length === 0}
              className="flex items-center gap-2 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
            >
              <Play size={15} />
              Run
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-y-auto p-8 bg-gray-50">
          {template.steps.length === 0 ? (
            <EmptyCanvas onAdd={addStep} />
          ) : (
            <div className="max-w-xl mx-auto">
              {template.steps.map((step, idx) => (
                <div key={step.id}>
                  <StepNode
                    step={step}
                    selected={selectedStepId === step.id}
                    onSelect={() =>
                      setSelectedStepId((id) => (id === step.id ? null : step.id))
                    }
                    onMoveUp={() => moveStep(step.id, -1)}
                    onMoveDown={() => moveStep(step.id, 1)}
                    onRemove={() => removeStep(step.id)}
                    isFirst={idx === 0}
                    isLast={idx === template.steps.length - 1}
                  />
                  {idx < template.steps.length - 1 && (
                    <div className="flex justify-center py-1">
                      <div className="w-px h-6 bg-gray-300" />
                    </div>
                  )}
                </div>
              ))}

              {/* Add step button */}
              <div className="flex justify-center mt-4">
                <AddStepMenu onAdd={addStep} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right panel — step detail */}
      {selectedStep && (
        <div className="w-80 bg-white border-l border-gray-200 overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900 text-sm">Step Properties</h3>
            <button
              onClick={() => setSelectedStepId(null)}
              className="p-1 rounded hover:bg-gray-100"
            >
              <X size={16} className="text-gray-500" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            <Field label="Name">
              <input
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={selectedStep.name}
                onChange={(e) => updateStep(selectedStep.id, { name: e.target.value })}
              />
            </Field>

            <Field label="Kind">
              <select
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
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
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
    </div>
  );
}

function StepNode({
  step,
  selected,
  onSelect,
  onMoveUp,
  onMoveDown,
  onRemove,
  isFirst,
  isLast,
}: {
  step: WorkflowStep;
  selected: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const meta = KIND_META[step.kind];

  return (
    <div
      onClick={onSelect}
      className={clsx(
        "group relative bg-white rounded-xl border-2 cursor-pointer transition-all",
        selected ? "border-blue-500 shadow-md" : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
      )}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Kind badge */}
          <div
            className={clsx(
              "flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium mt-0.5",
              meta.bg,
              meta.color
            )}
          >
            {meta.icon}
            {meta.label}
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 text-sm">{step.name}</p>
            {step.description && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{step.description}</p>
            )}
          </div>
        </div>

        {/* IO keys */}
        {(step.inputKeys.length > 0 || step.outputKeys.length > 0) && (
          <div className="flex gap-4 mt-3 text-xs">
            {step.inputKeys.length > 0 && (
              <div>
                <span className="text-gray-400 mr-1">in:</span>
                {step.inputKeys.map((k) => (
                  <span key={k} className="mr-1 px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                    {k}
                  </span>
                ))}
              </div>
            )}
            {step.outputKeys.length > 0 && (
              <div>
                <span className="text-gray-400 mr-1">out:</span>
                {step.outputKeys.map((k) => (
                  <span key={k} className="mr-1 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
                    {k}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions (show on hover) */}
      <div className="absolute right-3 top-3 hidden group-hover:flex items-center gap-1">
        {!isFirst && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"
          >
            <ChevronUp size={14} />
          </button>
        )}
        {!isLast && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700"
          >
            <ChevronDown size={14} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
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
        className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 text-gray-500 rounded-xl text-sm font-medium hover:border-blue-400 hover:text-blue-600 transition"
      >
        <Plus size={16} /> Add Step
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-white rounded-xl border border-gray-200 shadow-lg z-10 p-2 w-48">
          {kinds.map(([kind, meta]) => (
            <button
              key={kind}
              onClick={() => { onAdd(kind); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded-lg hover:bg-gray-50 transition"
            >
              <span className={clsx("p-1 rounded", meta.bg, meta.color)}>{meta.icon}</span>
              {meta.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyCanvas({ onAdd }: { onAdd: (k: StepKind) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
      <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
        <Zap size={28} className="text-blue-500" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Start building your workflow</h3>
      <p className="text-gray-500 text-sm mb-6 max-w-xs">
        Add steps to compose your AI workflow. Each step passes data to the next.
      </p>
      <AddStepMenu onAdd={onAdd} />

      <div className="mt-8">
        <p className="text-xs text-gray-400 mb-3">Or start from a template:</p>
        <div className="flex gap-2">
          {MOCK_TEMPLATES.map((t) => (
            <a
              key={t.id}
              href={`/builder/${t.id}`}
              className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 hover:border-blue-400 hover:text-blue-600 transition"
            >
              {t.name}
            </a>
          ))}
        </div>
      </div>
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
      <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
