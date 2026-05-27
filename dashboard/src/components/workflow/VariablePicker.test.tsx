/**
 * VariablePicker tests — HEL-241B sidecar variable picker.
 *
 * The picker's job is discoverability of upstream step outputKeys.
 * These tests cover the three states that matter:
 *
 *   - Picker is disabled when no other step exposes outputs.
 *   - Picker lists outputKeys grouped by step name when steps exist.
 *   - Selecting a variable emits the wrapped `{{key}}` literal.
 *
 * The caret-aware insertion is covered separately in
 * insertAtCaret.test.ts since it's pure logic with no UI.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react-original";
import type { WorkflowStep } from "../../types/workflow";
import { VariablePicker } from "./VariablePicker";

function makeStep(overrides: Partial<WorkflowStep> & Pick<WorkflowStep, "id">): WorkflowStep {
  return {
    name: "Step",
    kind: "llm",
    description: "",
    inputKeys: [],
    outputKeys: [],
    ...overrides,
  };
}

describe("VariablePicker", () => {
  it("disables the trigger when no other step exposes outputs", () => {
    render(
      <VariablePicker
        allSteps={[
          makeStep({ id: "self", outputKeys: ["foo"] }),
        ]}
        currentStepId="self"
        onInsert={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringMatching(/No upstream step/i));
  });

  it("opens the popover and lists upstream variables grouped by step", () => {
    render(
      <VariablePicker
        allSteps={[
          makeStep({ id: "self", outputKeys: [] }),
          makeStep({ id: "trigger-1", name: "Manual start", outputKeys: ["ticketId", "urgency"] }),
          makeStep({ id: "ask-1", name: "Ask AI", outputKeys: ["summary"] }),
        ]}
        currentStepId="self"
        onInsert={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Manual start")).toBeInTheDocument();
    expect(screen.getByText("Ask AI")).toBeInTheDocument();
    expect(screen.getByText("{{ticketId}}")).toBeInTheDocument();
    expect(screen.getByText("{{urgency}}")).toBeInTheDocument();
    expect(screen.getByText("{{summary}}")).toBeInTheDocument();
  });

  it("emits the wrapped literal when a variable is clicked", () => {
    const onInsert = vi.fn();
    render(
      <VariablePicker
        allSteps={[
          makeStep({ id: "self" }),
          makeStep({ id: "u1", name: "Trigger", outputKeys: ["ticketId"] }),
        ]}
        currentStepId="self"
        onInsert={onInsert}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("{{ticketId}}"));
    expect(onInsert).toHaveBeenCalledWith("{{ticketId}}");
  });

  it("filters the list when the user searches", () => {
    render(
      <VariablePicker
        allSteps={[
          makeStep({ id: "self" }),
          makeStep({ id: "u1", name: "Trigger", outputKeys: ["ticketId", "urgency"] }),
        ]}
        currentStepId="self"
        onInsert={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const search = screen.getByPlaceholderText("Search variables");
    fireEvent.change(search, { target: { value: "ticket" } });
    expect(screen.getByText("{{ticketId}}")).toBeInTheDocument();
    expect(screen.queryByText("{{urgency}}")).toBeNull();
  });

  it("excludes the current step from the list to prevent self-reference", () => {
    render(
      <VariablePicker
        allSteps={[
          makeStep({ id: "self", name: "Self", outputKeys: ["selfOnly"] }),
          makeStep({ id: "other", name: "Other", outputKeys: ["otherOut"] }),
        ]}
        currentStepId="self"
        onInsert={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Self")).toBeNull();
    expect(screen.queryByText("{{selfOnly}}")).toBeNull();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });
});
