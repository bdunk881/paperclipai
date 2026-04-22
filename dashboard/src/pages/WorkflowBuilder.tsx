import { useState, useEffect } from "react";
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
  Bot,
  UserCheck,
  Plug,
  FileInput,
  Sparkles,
  Loader,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { getTemplate, listTemplates, startRun, startRunWithFile, listLLMConfigs, generateWorkflow, type TemplateSummary, type LLMConfig } from "../api/client";
import { useAuth } from "../context/AuthContext";
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
  agent: {
    label: "Agent",
    icon: <Bot size={14} />,
    color: "text-indigo-700",
    bg: "bg-indigo-100 border-indigo-300",
  },
  approval: {
    label: "Approval",
    icon: <UserCheck size={14} />,
    color: "text-amber-700",
    bg: "bg-amber-100 border-amber-300",
  },
  mcp: {
    label: "MCP",
    icon: <Plug size={14} />,
    color: "text-teal-700",
    bg: "bg-teal-100 border-teal-300",
  },
  file_trigger: {
    label: "File Trigger",
    icon: <FileInput size={14} />,
    color: "text-rose-700",
    bg: "bg-rose-100 border-rose-300",
  },
};

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

export default function WorkflowBuilder() {
  const { templateId } = useParams<{ templateId?: string }>();
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();

  const [template, setTemplate] = useState<WorkflowTemplate>(BLANK_TEMPLATE);
  const [loading, setLoading] = useState(!!templateId);
  const [allTemplates, setAllTemplates] = useState<TemplateSummary[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>([]);
  const [llmConfigsLoading, setLlmConfigsLoading] = useState(false);
  const [llmConfigsError, setLlmConfigsError] = useState<string | null>(null);
  const [showNLModal, setShowNLModal] = useState(false);
  const [showFileUploadModal, setShowFileUploadModal] = useState(false);

  const hasFileTrigger = template.steps.some((s) => s.kind === "file_trigger");
  const fileTriggerStep = template.steps.find((s) => s.kind === "file_trigger");

  useEffect(() => {
    listTemplates().then(setAllTemplates).catch(console.error);
  }, []);

  useEffect(() => {
    if (!templateId) return;
    setLoading(true);
    getTemplate(templateId)
      .then(setTemplate)
      .catch((e) => console.error("Failed to load template:", e))
      .finally(() => setLoading(false));
  }, [templateId]);

  const selectedStep = template.steps.find((s) => s.id === selectedStepId) ?? null;
  const isLlmStep = selectedStep?.kind === "llm";

  useEffect(() => {
    if (!isLlmStep) return;
    setLlmConfigsLoading(true);
    setLlmConfigsError(null);
    void (async () => {
      try {
        const accessToken = (await getAccessToken()) ?? undefined;
        const configs = await listLLMConfigs(accessToken);
        setLlmConfigs(configs);
      } catch (e) {
        setLlmConfigsError(e instanceof Error ? e.message : "Failed to load providers");
      } finally {
        setLlmConfigsLoading(false);
      }
    })();
  }, [getAccessToken, isLlmStep]);

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

  async function handleRun() {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Loading template…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left panel — canvas */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {runError && (
          <div className="px-6 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
            {runError}
          </div>
        )}
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
              onClick={() => setShowNLModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 transition"
            >
              <Sparkles size={15} />
              Generate with AI
            </button>
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
            <EmptyCanvas onAdd={addStep} templates={allTemplates} />
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
                <Field label="MCP Server URL">
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
          getAccessToken={getAccessToken}
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
          getAccessToken={getAccessToken}
          onClose={() => setShowNLModal(false)}
          onApply={(steps) => {
            setTemplate((t) => ({ ...t, steps }));
            setShowNLModal(false);
          }}
        />
      )}
    </div>
  );
}

function NLWorkflowModal({
  getAccessToken,
  onClose,
  onApply,
}: {
  getAccessToken: () => Promise<string | null>;
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-purple-500" />
            <h2 className="font-semibold text-gray-900">Generate Workflow with AI</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Describe your workflow
            </label>
            <textarea
              className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
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
                <p className="text-xs font-medium text-gray-600 mb-2">
                  Preview — {preview.length} steps suggested
                </p>
                <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                  {preview.map((step, i) => {
                    const meta = KIND_META[step.kind];
                    return (
                      <div key={step.id} className="flex items-center gap-3 px-4 py-2.5 text-sm bg-white">
                        <span className="text-gray-300 text-xs w-4">{i + 1}</span>
                        <span className={clsx("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border", meta.bg, meta.color)}>
                          {meta.icon}
                          {meta.label}
                        </span>
                        <span className="text-gray-800 font-medium flex-1">{step.name}</span>
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
                  className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium transition"
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

// ---------------------------------------------------------------------------
// AgentCanvas — visual manager→worker hierarchy for agent steps
// ---------------------------------------------------------------------------

function AgentCanvas({ model, slots }: { model: string; slots: number }) {
  const workerSlots = Math.max(1, Math.min(slots, 20));
  return (
    <div
      className="mt-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-xs font-semibold text-indigo-700 mb-2 flex items-center gap-1">
        <Bot size={11} />
        Agent Topology
      </p>

      {/* Manager node */}
      <div className="flex justify-center mb-1">
        <div className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium shadow-sm">
          <Bot size={11} />
          Manager
          {model !== "default" && (
            <span className="ml-1 opacity-75 font-normal">{model}</span>
          )}
        </div>
      </div>

      {/* Connector lines */}
      <div className="flex justify-center gap-0 mb-1">
        {Array.from({ length: workerSlots }).map((_, i) => (
          <div key={i} className="flex flex-col items-center" style={{ width: `${100 / workerSlots}%` }}>
            <div className="w-px h-4 bg-indigo-300" />
          </div>
        ))}
      </div>

      {/* Worker nodes */}
      <div className="flex justify-center gap-1 flex-wrap">
        {Array.from({ length: workerSlots }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-1 px-2 py-1 bg-white border border-indigo-300 text-indigo-600 rounded-md text-xs"
          >
            <Bot size={10} />
            W{i}
          </div>
        ))}
      </div>

      <p className="text-xs text-indigo-500 mt-2 text-center">
        {workerSlots} parallel worker{workerSlots !== 1 ? "s" : ""} · results aggregated
      </p>
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

        {/* Agent canvas — inline hierarchy for agent steps */}
        {step.kind === "agent" && (
          <AgentCanvas
            model={step.agentModel ?? "default"}
            slots={step.subAgentSlots ?? 1}
          />
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

function EmptyCanvas({
  onAdd,
  templates,
}: {
  onAdd: (k: StepKind) => void;
  templates: TemplateSummary[];
}) {
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

      {templates.length > 0 && (
        <div className="mt-8">
          <p className="text-xs text-gray-400 mb-3">Or start from a template:</p>
          <div className="flex gap-2">
            {templates.map((t) => (
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
      <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
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
  getAccessToken,
  onClose,
  onStarted,
}: {
  templateId: string;
  acceptedFileTypes: string[];
  getAccessToken: () => Promise<string | null>;
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <UploadCloud size={18} className="text-rose-500" />
            <h2 className="font-semibold text-gray-900">Upload File to Run Workflow</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100" disabled={state === "uploading"}>
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
              dragOver ? "border-rose-400 bg-rose-50" : "border-gray-300 hover:border-rose-300 hover:bg-gray-50"
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
            <UploadCloud size={32} className={dragOver ? "text-rose-400" : "text-gray-300"} />
            <div>
              <p className="text-sm font-medium text-gray-700">
                {file ? file.name : "Drop a file here, or click to browse"}
              </p>
              {acceptedFileTypes.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  Accepted: {acceptedFileTypes.join(", ")}
                </p>
              )}
              {file && (
                <p className="text-xs text-gray-400 mt-1">
                  {(file.size / 1024).toFixed(1)} KB · {file.type || "unknown type"}
                </p>
              )}
            </div>
          </div>

          {/* Status */}
          {state === "error" && errorMsg && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          )}
          {state === "done" && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
              <CheckCircle2 size={15} className="shrink-0" />
              Run started — redirecting to monitor…
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={state === "uploading" || state === "done"}
              className="flex-1 py-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium transition disabled:opacity-50"
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
