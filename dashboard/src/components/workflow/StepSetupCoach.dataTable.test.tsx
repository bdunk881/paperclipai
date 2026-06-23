/**
 * StepSetupCoach — data_table guided card (HEL-814).
 *
 * Proves the inspector card for the data_table step kind renders the right
 * fields per operation and writes config.* patches the engine reads
 * (dataTableStep.ts): operation / table / rowKey / data / filter / limit.
 * The card stores data & filter as parsed JSON objects (so the engine
 * deep-interpolates leaves) but keeps a lone "{{key}}" template as a string.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react-original";
import { MemoryRouter } from "react-router-dom";
import type { WorkflowStep, WorkflowTemplate } from "../../types/workflow";
import { StepSetupCoach, buildStepSetupContext } from "./StepSetupCoach";

function dataTableStep(config: Record<string, unknown>): WorkflowStep {
  return {
    id: "s1",
    name: "Data table",
    kind: "data_table",
    description: "",
    inputKeys: [],
    outputKeys: [],
    config,
  };
}

function renderCoach(step: WorkflowStep) {
  const onUpdateStep = vi.fn();
  const template: WorkflowTemplate = {
    id: "t1",
    name: "T",
    description: "",
    category: "custom",
    version: "1.0.0",
    configFields: [],
    steps: [step],
    sampleInput: {},
    expectedOutput: {},
  };
  const setupContext = buildStepSetupContext(template, [], [], (k) => k);
  render(
    <MemoryRouter>
      <StepSetupCoach
        step={step}
        setupContext={setupContext}
        llmConfigs={[]}
        onUpdateStep={onUpdateStep}
        advancedContent={<div />}
      />
    </MemoryRouter>,
  );
  return { onUpdateStep };
}

describe("StepSetupCoach — data_table card", () => {
  it("renders the query card with table, filter, and limit (the default operation)", () => {
    renderCoach(dataTableStep({ table: "leads" }));
    expect(screen.getByText(/Read or write a data table/)).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("query");
    expect((screen.getByPlaceholderText("e.g. seen_tickets") as HTMLInputElement).value).toBe("leads");
    expect(screen.getByPlaceholderText('{ "status": "open" }')).toBeTruthy();
    expect(screen.getByPlaceholderText("e.g. 100")).toBeTruthy();
    // write-only fields are absent in query mode
    expect(screen.queryByPlaceholderText("e.g. {{email}}")).toBeNull();
  });

  it("renders rowKey + data for upsert and hides filter/limit", () => {
    renderCoach(dataTableStep({ operation: "upsert", table: "kv" }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("upsert");
    expect(screen.getByPlaceholderText("e.g. {{email}}")).toBeTruthy();
    expect(screen.getByPlaceholderText('{ "email": "{{email}}", "status": "open" }')).toBeTruthy();
    expect(screen.queryByPlaceholderText("e.g. 100")).toBeNull();
  });

  it("renders data (no rowKey) for insert", () => {
    renderCoach(dataTableStep({ operation: "insert", table: "t" }));
    expect(screen.getByPlaceholderText('{ "email": "{{email}}", "status": "open" }')).toBeTruthy();
    expect(screen.queryByPlaceholderText("e.g. {{email}}")).toBeNull();
  });

  it("writes a table-name patch into config", () => {
    const { onUpdateStep } = renderCoach(dataTableStep({ operation: "query" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. seen_tickets"), {
      target: { value: "orders" },
    });
    expect(onUpdateStep).toHaveBeenCalledWith({ config: { operation: "query", table: "orders" } });
  });

  it("writes an operation patch when the select changes", () => {
    const { onUpdateStep } = renderCoach(dataTableStep({ table: "t" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "upsert" } });
    expect(onUpdateStep).toHaveBeenCalledWith({ config: { table: "t", operation: "upsert" } });
  });

  it("stores valid JSON row data as a parsed object", () => {
    const { onUpdateStep } = renderCoach(dataTableStep({ operation: "insert", table: "t" }));
    fireEvent.change(
      screen.getByPlaceholderText('{ "email": "{{email}}", "status": "open" }'),
      { target: { value: '{"a":1}' } },
    );
    expect(onUpdateStep).toHaveBeenCalledWith({
      config: { operation: "insert", table: "t", data: { a: 1 } },
    });
  });

  it("keeps a lone {{template}} as a raw string (so a whole object can pass through)", () => {
    const { onUpdateStep } = renderCoach(dataTableStep({ operation: "insert", table: "t" }));
    fireEvent.change(
      screen.getByPlaceholderText('{ "email": "{{email}}", "status": "open" }'),
      { target: { value: "{{lead}}" } },
    );
    expect(onUpdateStep).toHaveBeenCalledWith({
      config: { operation: "insert", table: "t", data: "{{lead}}" },
    });
  });

  it("clears the data key when the editor is emptied", () => {
    const { onUpdateStep } = renderCoach(dataTableStep({ operation: "insert", table: "t", data: { a: 1 } }));
    fireEvent.change(
      screen.getByPlaceholderText('{ "email": "{{email}}", "status": "open" }'),
      { target: { value: "  " } },
    );
    expect(onUpdateStep).toHaveBeenCalledWith({
      config: { operation: "insert", table: "t", data: undefined },
    });
  });
});
