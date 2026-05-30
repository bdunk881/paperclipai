import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react-original";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { YTextInput } from "./YTextInput";

function renderInput({
  yText,
  value,
  onChangeValue = vi.fn(),
}: {
  yText: Y.Text | null;
  value: string;
  onChangeValue?: (value: string) => void;
}) {
  render(
    <YTextInput
      aria-label="Step name"
      data-field="name"
      yText={yText}
      value={value}
      onChangeValue={onChangeValue}
    />,
  );
  return {
    input: screen.getByLabelText("Step name") as HTMLInputElement,
    onChangeValue,
  };
}

describe("YTextInput", () => {
  it("writes local input changes into the Y.Text", () => {
    const doc = new Y.Doc();
    const yText = doc.getText("name");
    yText.insert(0, "Agent");
    const onChangeValue = vi.fn();
    const { input } = renderInput({ yText, value: "Agent", onChangeValue });

    fireEvent.change(input, { target: { value: "Agent Step" } });

    expect(yText.toString()).toBe("Agent Step");
    expect(onChangeValue).toHaveBeenCalledTimes(1);
    expect(onChangeValue).toHaveBeenLastCalledWith("Agent Step");
  });

  it("applies remote Y.Text changes to the input", () => {
    const doc = new Y.Doc();
    const yText = doc.getText("name");
    yText.insert(0, "Agent");
    const onChangeValue = vi.fn();
    const { input } = renderInput({ yText, value: "Agent", onChangeValue });

    act(() => {
      yText.insert(5, " Step");
    });

    expect(input).toHaveValue("Agent Step");
    expect(onChangeValue).toHaveBeenLastCalledWith("Agent Step");
  });

  it("keeps the local cursor anchored when a remote insertion lands before it", () => {
    const doc = new Y.Doc();
    const yText = doc.getText("name");
    yText.insert(0, "Agent");
    const { input } = renderInput({ yText, value: "Agent" });

    input.focus();
    input.setSelectionRange(2, 2);

    act(() => {
      yText.insert(0, "AI ");
    });

    expect(input).toHaveValue("AI Agent");
    expect(input.selectionStart).toBe(5);
    expect(input.selectionEnd).toBe(5);
  });

  it("round-trips edits between two inputs bound to the same Y.Text", () => {
    const doc = new Y.Doc();
    const yText = doc.getText("name");
    const firstChange = vi.fn();
    const secondChange = vi.fn();

    render(
      <div>
        <YTextInput
          aria-label="First step name"
          yText={yText}
          value=""
          onChangeValue={firstChange}
        />
        <YTextInput
          aria-label="Second step name"
          yText={yText}
          value=""
          onChangeValue={secondChange}
        />
      </div>,
    );

    const first = screen.getByLabelText("First step name") as HTMLInputElement;
    const second = screen.getByLabelText("Second step name") as HTMLInputElement;

    fireEvent.change(first, { target: { value: "A" } });
    expect(second).toHaveValue("A");

    fireEvent.change(second, { target: { value: "AB" } });
    expect(first).toHaveValue("AB");
    expect(yText.toString()).toBe("AB");
  });

  it("falls back to a normal controlled input when no Y.Text is available", () => {
    const onChangeValue = vi.fn();
    const { input } = renderInput({ yText: null, value: "Draft", onChangeValue });

    fireEvent.change(input, { target: { value: "Draft Name" } });

    expect(input).toHaveValue("Draft Name");
    expect(onChangeValue).toHaveBeenCalledWith("Draft Name");
  });
});
