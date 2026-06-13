/**
 * Public hosted form page (HEL-775, Phase 1).
 *
 * The dashboard half of the form-trigger feature. An UNAUTHENTICATED route
 * (`/forms/:workflowId`, registered outside PrivateRoute/Layout) that renders a
 * workflow's `form_trigger` definition and submits it:
 *
 *   GET  {API}/forms/:workflowId  → { workflowId, title, description, fields }
 *   POST {API}/forms/:workflowId  → 202 { runId }  |  400 { error, fields }
 *
 * The backend (src/forms/formRoutes.ts) treats the workflow UUID as the public
 * bearer secret and only resolves workflows whose head is a `form_trigger`, so
 * no auth token is sent. Field types + validation are the engine's
 * (src/engine/formTriggerStep.ts); this page mirrors them for rendering and
 * surfaces the server's per-field errors verbatim.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle, AlertCircle } from "lucide-react";
import { getApiBasePath } from "../api/baseUrl";

type FormFieldType = "text" | "textarea" | "number" | "email" | "select" | "checkbox";

interface FormFieldDef {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
}

interface FormDefinition {
  workflowId: string;
  title: string;
  description: string;
  fields: FormFieldDef[];
}

type Status = "loading" | "not_found" | "ready" | "submitting" | "success" | "error";

type FieldValue = string | boolean;

const INPUT_CLS =
  "w-full rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-af2-paper flex items-center justify-center p-4 sm:p-8">
      <div className="af2-card w-full max-w-lg p-8 sm:p-10 shadow-af2-lg">{children}</div>
    </div>
  );
}

export default function PublicForm() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [status, setStatus] = useState<Status>("loading");
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    if (!workflowId) {
      setStatus("not_found");
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${getApiBasePath()}/forms/${workflowId}`);
        if (res.status === 404) {
          if (!cancelled) setStatus("not_found");
          return;
        }
        if (!res.ok) throw new Error(`Could not load this form (${res.status}).`);
        const def = (await res.json()) as FormDefinition;
        if (cancelled) return;
        const seed: Record<string, FieldValue> = {};
        for (const field of def.fields) seed[field.key] = field.type === "checkbox" ? false : "";
        setForm(def);
        setValues(seed);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setErrorMessage(e instanceof Error ? e.message : "Could not load this form.");
          setStatus("error");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  function setValue(key: string, value: FieldValue) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form || !workflowId) return;
    setStatus("submitting");
    setFieldErrors({});
    setErrorMessage("");
    try {
      const res = await fetch(`${getApiBasePath()}/forms/${workflowId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (res.status === 202) {
        setStatus("success");
        return;
      }
      if (res.status === 400) {
        const body = (await res.json()) as { error?: string; fields?: Record<string, string> };
        setFieldErrors(body.fields ?? {});
        setErrorMessage("Please fix the highlighted fields.");
        setStatus("ready");
        return;
      }
      throw new Error(`Submission failed (${res.status}).`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Submission failed.");
      setStatus("ready");
    }
  }

  if (status === "loading") {
    return (
      <Shell>
        <p className="text-center text-sm text-af2-ink-3">Loading form…</p>
      </Shell>
    );
  }

  if (status === "not_found") {
    return (
      <Shell>
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto mb-4 text-af2-ink-4" />
          <h1 className="font-af2-serif text-xl font-bold text-af2-ink">Form not found</h1>
          <p className="mt-2 text-sm text-af2-ink-2">
            This form does not exist or is no longer accepting responses.
          </p>
        </div>
      </Shell>
    );
  }

  if (status === "error") {
    return (
      <Shell>
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto mb-4 text-af2-clay" />
          <h1 className="font-af2-serif text-xl font-bold text-af2-ink">Something went wrong</h1>
          <p className="mt-2 text-sm text-af2-ink-2">{errorMessage}</p>
        </div>
      </Shell>
    );
  }

  if (status === "success") {
    return (
      <Shell>
        <div className="text-center">
          <CheckCircle size={56} className="mx-auto mb-6 text-af2-sage" />
          <h1 className="font-af2-serif text-2xl font-bold text-af2-ink">Thank you!</h1>
          <p className="mt-3 text-sm text-af2-ink-2">Your response has been recorded.</p>
        </div>
      </Shell>
    );
  }

  // ready | submitting
  const fields = form?.fields ?? [];
  const submitting = status === "submitting";
  return (
    <Shell>
      <h1 className="font-af2-serif text-2xl font-bold text-af2-ink">
        {form?.title || "Untitled form"}
      </h1>
      {form?.description ? (
        <p className="mt-2 text-sm leading-relaxed text-af2-ink-2">{form.description}</p>
      ) : null}

      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        {fields.length === 0 ? (
          <p className="text-sm text-af2-ink-3">This form has no fields yet.</p>
        ) : (
          fields.map((field) => {
            const err = fieldErrors[field.key];
            const value = values[field.key];
            return (
              <div key={field.key}>
                {field.type === "checkbox" ? (
                  <label className="flex items-center gap-2 text-sm text-af2-ink-2">
                    <input
                      type="checkbox"
                      checked={value === true}
                      disabled={submitting}
                      onChange={(e) => setValue(field.key, e.target.checked)}
                    />
                    {field.label}
                    {field.required ? <span className="text-af2-clay">*</span> : null}
                  </label>
                ) : (
                  <label className="block text-sm font-medium text-af2-ink-2">
                    <span className="mb-1.5 block">
                      {field.label}
                      {field.required ? <span className="text-af2-clay"> *</span> : null}
                    </span>
                    {field.type === "textarea" ? (
                      <textarea
                        className={`${INPUT_CLS} resize-none`}
                        rows={4}
                        required={field.required}
                        disabled={submitting}
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => setValue(field.key, e.target.value)}
                      />
                    ) : field.type === "select" ? (
                      <select
                        className={INPUT_CLS}
                        required={field.required}
                        disabled={submitting}
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => setValue(field.key, e.target.value)}
                      >
                        <option value="">Choose…</option>
                        {(field.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type === "number" ? "number" : field.type === "email" ? "email" : "text"}
                        className={INPUT_CLS}
                        required={field.required}
                        disabled={submitting}
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) => setValue(field.key, e.target.value)}
                      />
                    )}
                  </label>
                )}
                {err ? <p className="mt-1 text-xs text-af2-clay">{err}</p> : null}
              </div>
            );
          })
        )}

        {errorMessage ? <p className="text-xs text-af2-clay">{errorMessage}</p> : null}

        <button
          type="submit"
          disabled={submitting || fields.length === 0}
          className="w-full rounded-md bg-af2-clay py-2.5 text-sm font-semibold text-white transition hover:bg-af2-clay/85 disabled:opacity-60"
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </form>
    </Shell>
  );
}
