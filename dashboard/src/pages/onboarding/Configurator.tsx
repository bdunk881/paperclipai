import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Zap, Loader2, Play, AlertCircle } from "lucide-react";
import clsx from "clsx";
import { getTemplate, startRun } from "../../api/client";
import type { WorkflowTemplate, ConfigField } from "../../types/workflow";
import { useOnboarding } from "../../context/OnboardingContext";

function trackEvent(name: string, props?: Record<string, unknown>) {
  // Telemetry stub — replace with real analytics in production
  console.info("[telemetry]", name, props);
}

function FieldInput({
  field,
  value,
  onChange,
  error,
}: {
  field: ConfigField;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const base =
    "w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const errCls = error ? "border-red-300 bg-red-50" : "border-gray-300";

  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm text-gray-700">{field.label}</span>
      </label>
    );
  }

  if (field.options && field.options.length > 0) {
    return (
      <>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={clsx(base, errCls)}
        >
          <option value="">Select…</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </>
    );
  }

  return (
    <>
      <input
        type={field.type === "number" ? "number" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.description ?? `Enter ${field.label.toLowerCase()}`}
        className={clsx(base, errCls)}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </>
  );
}

export default function OnboardingConfigurator() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { setConfigValues, setLastRunId } = useOnboarding();

  const [template, setTemplate] = useState<WorkflowTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    if (!templateId) return;
    getTemplate(templateId)
      .then((tpl) => {
        setTemplate(tpl);
        // Pre-fill defaults
        const defaults: Record<string, string> = {};
        for (const field of tpl.configFields) {
          defaults[field.key] =
            field.defaultValue !== undefined ? String(field.defaultValue) : "";
        }
        setValues(defaults);
      })
      .finally(() => setLoading(false));
  }, [templateId]);

  function setValue(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
  }

  function validate(): boolean {
    if (!template) return false;
    const errs: Record<string, string> = {};
    for (const field of template.configFields) {
      if (field.required && !values[field.key]?.trim()) {
        errs[field.key] = `${field.label} is required.`;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleRun(e: React.FormEvent) {
    e.preventDefault();
    if (!template || !validate()) return;

    setRunning(true);
    setRunError(null);

    const config: Record<string, unknown> = {};
    for (const field of template.configFields) {
      const raw = values[field.key];
      config[field.key] =
        field.type === "number" ? Number(raw) : field.type === "boolean" ? raw === "true" : raw;
    }

    setConfigValues(config);

    try {
      const run = await startRun(template.id, template.sampleInput, config);
      trackEvent("onboarding.run_launched", { templateId: template.id, runId: run.id });
      setLastRunId(run.id);
      navigate("/onboarding/success", { state: { run } });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Failed to start run. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-blue-500" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Template not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600">
          <Zap size={16} className="text-white" />
        </div>
        <span className="font-bold text-gray-900">AutoFlow</span>
        <span className="text-gray-300 mx-2">|</span>
        <span className="text-sm text-gray-500">Step 2 of 3 — Configure &amp; launch</span>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{template.name}</h1>
          <p className="text-gray-500 text-sm">{template.description}</p>
        </div>

        <form onSubmit={handleRun} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
          <h2 className="font-semibold text-gray-900 text-base">Configuration</h2>

          {template.configFields.length === 0 && (
            <p className="text-sm text-gray-400 italic">
              This template requires no configuration — you're ready to run!
            </p>
          )}

          {template.configFields.map((field) => (
            <div key={field.key}>
              {field.type !== "boolean" && (
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {field.label}
                  {field.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
              )}
              {field.description && field.type !== "boolean" && (
                <p className="text-xs text-gray-400 mb-1.5">{field.description}</p>
              )}
              <FieldInput
                field={field}
                value={values[field.key] ?? ""}
                onChange={(v) => setValue(field.key, v)}
                error={errors[field.key]}
              />
            </div>
          ))}

          {runError && (
            <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              {runError}
            </div>
          )}

          <div className="pt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => navigate("/onboarding/templates")}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={running}
              data-testid="run-workflow-btn"
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors"
            >
              {running ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Launching…
                </>
              ) : (
                <>
                  <Play size={16} />
                  Run this workflow
                </>
              )}
            </button>
          </div>
        </form>

        {/* Step preview */}
        <div className="mt-6">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
            Workflow steps ({template.steps.length})
          </p>
          <ol className="space-y-2">
            {template.steps.map((step, i) => (
              <li key={step.id} className="flex items-center gap-3 text-sm text-gray-600">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-100 border border-gray-300 flex items-center justify-center text-xs font-medium text-gray-500">
                  {i + 1}
                </span>
                <span className="font-medium text-gray-700">{step.name}</span>
                <span className="text-gray-400">— {step.description}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
