/**
 * NodeConfigForm — schema-driven inspector form (HEL-241A).
 *
 * Each step kind declares a flat `FieldDef[]` manifest in
 * `pages/workflowStepSetup.ts`. The Studio inspector renders the
 * manifest via this generic component instead of branching on
 * `selectedStep.kind === "..."` with hand-rolled JSX.
 *
 * Why a homegrown manifest, not zod/JSON-Schema/@rjsf:
 *
 *   1. Internal scope today — 12 step kinds we control. Pure-JSON
 *      marketplace-author authoring isn't a near-term requirement.
 *   2. A flat manifest is already a JSON Schema in spirit; if we
 *      later need the standard, the migration is mechanical.
 *   3. Custom widgets (connector picker, llm-config picker, agent
 *      role picker) are easier to express as named widget kinds
 *      than as @rjsf custom widgets behind a uiSchema.
 *
 * The renderer reads field values from `step[key]` directly and
 * emits patches via `onChange({ [key]: nextValue })`. Field keys
 * must match `WorkflowStep` member names for the v1 (no nested
 * `config` reads) — see workflowStepSetup.ts manifests for the
 * canonical examples.
 */
import { useRef } from "react";
import type { WorkflowStep } from "../../types/workflow";
import { VariablePicker } from "./VariablePicker";
import { insertAtCaret } from "./insertAtCaret";

/**
 * Info callout — not actually a field, just inline help text the
 * manifest can interleave with real fields. Tone matches the af2
 * status palette (mustard = warning, sage = success, etc.).
 */
export interface InfoCalloutDef {
  widget: "info";
  /** Stable key for React reconciliation; not a field on the step. */
  key: string;
  tone: "mustard" | "sage" | "clay" | "blue";
  text: string;
}

interface BaseField {
  /** Must match a key on WorkflowStep for read/write to work. */
  key: keyof WorkflowStep & string;
  label: string;
  /** Optional inline help shown under the input. */
  help?: string;
  placeholder?: string;
}

export interface TextFieldDef extends BaseField {
  widget: "text";
  /** Render with a monospace font (good for IDs, expressions). */
  mono?: boolean;
}

export interface LongTextFieldDef extends BaseField {
  widget: "longtext";
  rows?: number;
}

export interface NumberFieldDef extends BaseField {
  widget: "number";
  min?: number;
  max?: number;
  /** Fallback value if the user leaves the field blank or types junk. */
  defaultValue?: number;
}

export interface StringArrayFieldDef extends BaseField {
  widget: "string-array";
  /** UI separator hint shown in the label ("comma-separated", etc.). */
  separator?: "comma";
}

export type FieldDef =
  | TextFieldDef
  | LongTextFieldDef
  | NumberFieldDef
  | StringArrayFieldDef
  | InfoCalloutDef;

const INPUT_CLS =
  "w-full px-3 py-2 text-sm border border-af2-line-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-af2-clay/30 bg-af2-card text-af2-ink";
const INPUT_MONO_CLS = `${INPUT_CLS} font-mono`;

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-af2-ink-3 mb-1.5">{label}</label>
      {children}
      {help ? <p className="mt-1.5 text-[11px] text-af2-ink-4">{help}</p> : null}
    </div>
  );
}

function InfoCallout({ tone, text }: { tone: InfoCalloutDef["tone"]; text: string }) {
  const toneClass = {
    mustard: "border-af2-mustard/30 bg-af2-mustard/10 text-af2-mustard",
    sage: "border-af2-sage/30 bg-af2-sage/10 text-af2-sage",
    clay: "border-af2-clay/30 bg-af2-clay/10 text-af2-clay",
    blue: "border-af2-line bg-af2-paper-3 text-af2-ink-2",
  }[tone];
  return (
    <div className={`px-3 py-2.5 rounded-lg border text-xs leading-relaxed ${toneClass}`}>
      {text}
    </div>
  );
}

export function NodeConfigForm({
  fields,
  step,
  onChange,
  disabled,
  allSteps,
}: {
  fields: FieldDef[];
  step: WorkflowStep;
  onChange: (patch: Partial<WorkflowStep>) => void;
  disabled?: boolean;
  /**
   * HEL-241B — full workflow step list, so text + longtext fields
   * can offer a "+ Variable" picker that surfaces upstream
   * `outputKeys`. Optional so callers that don't need the picker
   * (or aren't in a workflow context) can omit it.
   */
  allSteps?: WorkflowStep[];
}) {
  return (
    <>
      {fields.map((field) => {
        if (field.widget === "info") {
          return <InfoCallout key={field.key} tone={field.tone} text={field.text} />;
        }
        return (
          <Field key={field.key} label={field.label} help={field.help}>
            <FieldInput
              field={field}
              step={step}
              onChange={onChange}
              disabled={disabled}
              allSteps={allSteps}
            />
          </Field>
        );
      })}
    </>
  );
}

function FieldInput({
  field,
  step,
  onChange,
  disabled,
  allSteps,
}: {
  field: TextFieldDef | LongTextFieldDef | NumberFieldDef | StringArrayFieldDef;
  step: WorkflowStep;
  onChange: (patch: Partial<WorkflowStep>) => void;
  disabled?: boolean;
  allSteps?: WorkflowStep[];
}) {
  if (field.widget === "text") {
    return (
      <TextFieldInput
        field={field}
        step={step}
        onChange={onChange}
        disabled={disabled}
        allSteps={allSteps}
      />
    );
  }
  if (field.widget === "longtext") {
    return (
      <LongTextFieldInput
        field={field}
        step={step}
        onChange={onChange}
        disabled={disabled}
        allSteps={allSteps}
      />
    );
  }
  if (field.widget === "number") {
    const raw = step[field.key];
    const value = typeof raw === "number" ? raw : field.defaultValue ?? "";
    return (
      <input
        type="number"
        className={INPUT_CLS}
        placeholder={field.placeholder}
        min={field.min}
        max={field.max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const parsed = parseInt(e.target.value, 10);
          const next = Number.isFinite(parsed) ? parsed : field.defaultValue;
          onChange({ [field.key]: next } as Partial<WorkflowStep>);
        }}
      />
    );
  }
  // string-array
  const arr = (step[field.key] as string[] | undefined) ?? [];
  return (
    <input
      className={INPUT_CLS}
      placeholder={field.placeholder}
      value={arr.join(", ")}
      disabled={disabled}
      onChange={(e) =>
        onChange({
          [field.key]: e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        } as Partial<WorkflowStep>)
      }
    />
  );
}

/**
 * Text + longtext widgets get the sidecar VariablePicker. Extracted
 * into their own sub-components so we can keep an input ref for
 * caret-aware insertion without affecting the other widget kinds.
 */
function TextFieldInput({
  field,
  step,
  onChange,
  disabled,
  allSteps,
}: {
  field: TextFieldDef;
  step: WorkflowStep;
  onChange: (patch: Partial<WorkflowStep>) => void;
  disabled?: boolean;
  allSteps?: WorkflowStep[];
}) {
  const ref = useRef<HTMLInputElement>(null);
  const value = (step[field.key] as string | undefined) ?? "";
  const handleInsert = (literal: string) => {
    const { next, nextCaret } = insertAtCaret(ref, value, literal);
    onChange({ [field.key]: next } as Partial<WorkflowStep>);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus();
        ref.current.setSelectionRange(nextCaret, nextCaret);
      }
    });
  };
  return (
    <div className="relative">
      <input
        ref={ref}
        className={`${field.mono ? INPUT_MONO_CLS : INPUT_CLS} ${allSteps ? "pr-20" : ""}`}
        placeholder={field.placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) =>
          onChange({ [field.key]: e.target.value } as Partial<WorkflowStep>)
        }
      />
      {allSteps && (
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
          <VariablePicker
            allSteps={allSteps}
            currentStepId={step.id}
            onInsert={handleInsert}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

function LongTextFieldInput({
  field,
  step,
  onChange,
  disabled,
  allSteps,
}: {
  field: LongTextFieldDef;
  step: WorkflowStep;
  onChange: (patch: Partial<WorkflowStep>) => void;
  disabled?: boolean;
  allSteps?: WorkflowStep[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = (step[field.key] as string | undefined) ?? "";
  const handleInsert = (literal: string) => {
    const { next, nextCaret } = insertAtCaret(ref, value, literal);
    onChange({ [field.key]: next } as Partial<WorkflowStep>);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus();
        ref.current.setSelectionRange(nextCaret, nextCaret);
      }
    });
  };
  return (
    <div className="relative">
      <textarea
        ref={ref}
        className={`${INPUT_CLS} resize-none`}
        placeholder={field.placeholder}
        rows={field.rows ?? 3}
        value={value}
        disabled={disabled}
        onChange={(e) =>
          onChange({ [field.key]: e.target.value } as Partial<WorkflowStep>)
        }
      />
      {allSteps && (
        <div className="absolute right-1.5 top-1.5">
          <VariablePicker
            allSteps={allSteps}
            currentStepId={step.id}
            onInsert={handleInsert}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
