/**
 * NodeConfigForm tests — HEL-241A schema-driven inspector.
 *
 * Covers the four widget kinds the v1 manifests use today:
 *
 *   - text       (mcp.mcpServerUrl, condition.condition)
 *   - longtext   (no kind uses this yet; covered for completeness)
 *   - number     (approval.approvalTimeoutMinutes)
 *   - string-array (file_trigger.acceptedFileTypes)
 *   - info       (callout — emits no field, just text)
 *
 * The renderer is a leaf component (no providers needed), so we use
 * the raw @testing-library/react render — no shared harness mock.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react-original";
import type { WorkflowStep } from "../../types/workflow";
import {
  NodeConfigForm,
  type FieldDef,
} from "./NodeConfigForm";

const BASE_STEP: WorkflowStep = {
  id: "step-1",
  name: "Test step",
  kind: "approval",
  description: "",
  inputKeys: [],
  outputKeys: [],
};

describe("NodeConfigForm", () => {
  it("renders a text widget with value and emits patches on change", () => {
    const onChange = vi.fn();
    const fields: FieldDef[] = [
      { widget: "text", key: "condition", label: "Condition", mono: true, placeholder: "e.g. urgency === \"high\"" },
    ];
    render(
      <NodeConfigForm
        fields={fields}
        step={{ ...BASE_STEP, condition: "urgency === \"high\"" }}
        onChange={onChange}
      />,
    );
    const input = screen.getByPlaceholderText('e.g. urgency === "high"') as HTMLInputElement;
    expect(input.value).toBe('urgency === "high"');
    fireEvent.change(input, { target: { value: "kind === \"refund\"" } });
    expect(onChange).toHaveBeenCalledWith({ condition: 'kind === "refund"' });
  });

  it("renders a number widget with default value when the step has none", () => {
    const onChange = vi.fn();
    const fields: FieldDef[] = [
      { widget: "number", key: "approvalTimeoutMinutes", label: "Timeout", defaultValue: 60, placeholder: "60", min: 1 },
    ];
    render(<NodeConfigForm fields={fields} step={BASE_STEP} onChange={onChange} />);
    const input = screen.getByPlaceholderText("60") as HTMLInputElement;
    // Falls back to defaultValue when the step has no value.
    expect(input.value).toBe("60");
    fireEvent.change(input, { target: { value: "120" } });
    expect(onChange).toHaveBeenCalledWith({ approvalTimeoutMinutes: 120 });
  });

  it("string-array joins on display and splits on change", () => {
    const onChange = vi.fn();
    const fields: FieldDef[] = [
      { widget: "string-array", key: "acceptedFileTypes", label: "File types", placeholder: ".pdf, .png", separator: "comma" },
    ];
    render(
      <NodeConfigForm
        fields={fields}
        step={{ ...BASE_STEP, acceptedFileTypes: [".pdf", ".png"] }}
        onChange={onChange}
      />,
    );
    const input = screen.getByPlaceholderText(".pdf, .png") as HTMLInputElement;
    expect(input.value).toBe(".pdf, .png");
    fireEvent.change(input, { target: { value: ".pdf,.png,.mp3 ,  " } });
    expect(onChange).toHaveBeenCalledWith({
      acceptedFileTypes: [".pdf", ".png", ".mp3"],
    });
  });

  it("longtext renders a textarea with the given row count", () => {
    const onChange = vi.fn();
    const fields: FieldDef[] = [
      { widget: "longtext", key: "description", label: "Description", rows: 5, placeholder: "Long..." },
    ];
    render(<NodeConfigForm fields={fields} step={BASE_STEP} onChange={onChange} />);
    const textarea = screen.getByPlaceholderText("Long...") as HTMLTextAreaElement;
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.rows).toBe(5);
  });

  it("info callouts render text without any input control", () => {
    const fields: FieldDef[] = [
      { widget: "info", key: "callout-1", tone: "mustard", text: "Workflow will pause here." },
    ];
    render(<NodeConfigForm fields={fields} step={BASE_STEP} onChange={vi.fn()} />);
    expect(screen.getByText("Workflow will pause here.")).toBeInTheDocument();
    // No input elements should have been rendered.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("disables all inputs when disabled prop is set", () => {
    const fields: FieldDef[] = [
      { widget: "text", key: "condition", label: "Condition" },
      { widget: "number", key: "approvalTimeoutMinutes", label: "Timeout", defaultValue: 60 },
    ];
    render(<NodeConfigForm fields={fields} step={BASE_STEP} onChange={vi.fn()} disabled />);
    const inputs = screen.getAllByRole("spinbutton").concat(screen.getAllByRole("textbox"));
    for (const el of inputs) {
      expect(el).toBeDisabled();
    }
  });
});
