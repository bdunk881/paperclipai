/**
 * JsonTreeViewer tests — HEL-239 Pro JSON tree renderer.
 *
 * Covers the collapse/expand interaction that distinguishes the Pro
 * surface from the free <pre> rendering. We don't unit-test colour
 * roles or formatting — those are visual, and the existing JsonValue
 * renderer in RunAuditSidebar has covered them since launch.
 */
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react-original";
import { JsonTreeViewer } from "./JsonTreeViewer";

describe("JsonTreeViewer", () => {
  it("renders nested objects with key and value", () => {
    render(<JsonTreeViewer value={{ name: "step-1", count: 3 }} />);
    expect(screen.getByText('"name"')).toBeInTheDocument();
    expect(screen.getByText('"step-1"')).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("collapses a nested object on click and shows key count", () => {
    render(
      <JsonTreeViewer
        value={{ outer: { a: 1, b: 2, c: 3 } }}
        initialOpenDepth={5}
      />,
    );
    // Outer expanded → inner keys visible.
    expect(screen.getByText('"a"')).toBeInTheDocument();
    // Click the inner object's opening `{` to collapse.
    const innerOpen = screen.getAllByRole("button").find((b) =>
      b.getAttribute("aria-expanded") === "true" && b.textContent?.includes('"outer"'),
    );
    expect(innerOpen).toBeTruthy();
    fireEvent.click(innerOpen!);
    // Children should be hidden; count summary visible.
    expect(screen.queryByText('"a"')).toBeNull();
    expect(screen.getByText(/3 keys/)).toBeInTheDocument();
  });

  it("renders arrays with an items summary when collapsed", () => {
    render(<JsonTreeViewer value={[1, 2, 3]} initialOpenDepth={0} />);
    expect(screen.getByText(/3 items/)).toBeInTheDocument();
  });

  it("does not crash on primitive root values", () => {
    render(<JsonTreeViewer value="hello" />);
    expect(screen.getByText('"hello"')).toBeInTheDocument();
  });

  it("renders empty objects without a toggle", () => {
    render(<JsonTreeViewer value={{}} />);
    // No collapse summary because there are no entries.
    expect(screen.queryByText(/0 keys/)).toBeNull();
  });
});
