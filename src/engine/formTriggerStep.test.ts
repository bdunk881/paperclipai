/**
 * HEL-676: form trigger — pure helper unit tests (field parse, submission
 * validation/coercion, head lookup, context hoist).
 */

import {
  parseFormFields,
  validateFormSubmission,
  findFormTriggerStep,
  handleFormTrigger,
} from "./formTriggerStep";
import type { WorkflowStep, WorkflowTemplate } from "../types/workflow";

function makeStep(config: Record<string, unknown>): WorkflowStep {
  return {
    id: "f",
    name: "f",
    kind: "form_trigger",
    description: "",
    inputKeys: [],
    outputKeys: [],
    config,
  };
}

describe("parseFormFields (HEL-676)", () => {
  it("normalises field defs and drops invalid entries", () => {
    const fields = parseFormFields(
      makeStep({
        formFields: [
          { key: "name", label: "Your name", type: "text", required: true },
          { key: "age", type: "number" },
          { type: "text" },
          { key: "plan", type: "select", options: ["a", "b", 3] },
          "nope",
        ],
      }),
    );
    expect(fields).toEqual([
      { key: "name", label: "Your name", type: "text", required: true },
      { key: "age", label: "age", type: "number", required: false },
      { key: "plan", label: "plan", type: "select", required: false, options: ["a", "b"] },
    ]);
  });

  it("returns [] when there are no formFields", () => {
    expect(parseFormFields(makeStep({}))).toEqual([]);
  });
});

describe("validateFormSubmission (HEL-676)", () => {
  const fields = parseFormFields(
    makeStep({
      formFields: [
        { key: "name", type: "text", required: true },
        { key: "age", type: "number" },
        { key: "email", type: "email", required: true },
        { key: "plan", type: "select", options: ["free", "pro"] },
        { key: "agree", type: "checkbox" },
      ],
    }),
  );

  it("coerces valid values", () => {
    const r = validateFormSubmission(fields, {
      name: "Ada",
      age: "42",
      email: "a@b.io",
      plan: "pro",
      agree: "on",
    });
    expect(r).toEqual({
      ok: true,
      values: { name: "Ada", age: 42, email: "a@b.io", plan: "pro", agree: true },
    });
  });

  it("flags a missing required field", () => {
    const r = validateFormSubmission(fields, { email: "a@b.io" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveProperty("name");
  });

  it("flags a bad number / email / disallowed option", () => {
    const r = validateFormSubmission(fields, {
      name: "x",
      age: "abc",
      email: "nope",
      plan: "enterprise",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveProperty("age");
      expect(r.errors).toHaveProperty("email");
      expect(r.errors).toHaveProperty("plan");
    }
  });
});

describe("findFormTriggerStep / handleFormTrigger (HEL-676)", () => {
  it("finds the form_trigger head", () => {
    const tpl = {
      steps: [makeStep({}), { id: "o", kind: "output" }],
    } as unknown as WorkflowTemplate;
    expect(findFormTriggerStep(tpl)?.kind).toBe("form_trigger");
  });

  it("hoists the submitted form values + keeps the nested form", () => {
    const out = handleFormTrigger({ form: { name: "Ada", age: 42 } });
    expect(out).toMatchObject({ name: "Ada", age: 42, form: { name: "Ada", age: 42 } });
  });

  it("is a safe no-op shape with no submission", () => {
    expect(handleFormTrigger({})).toEqual({ form: {} });
  });
});
