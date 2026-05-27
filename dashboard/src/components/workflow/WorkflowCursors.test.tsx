/**
 * WorkflowCursors tests — HEL-241C v2.
 *
 * We mock @xyflow/react's ViewportPortal so the component can render
 * outside a <ReactFlowProvider> in jsdom — the portal is otherwise
 * required to be inside the flow context.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react-original";
import { WorkflowCursors } from "./WorkflowCursors";
import type { WorkflowPresencePeer } from "../../api/workflowsApi";

vi.mock("@xyflow/react", () => ({
  ViewportPortal: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="viewport-portal-stub">{children}</div>
  ),
}));

function peer(
  overrides: Partial<WorkflowPresencePeer> & Pick<WorkflowPresencePeer, "userId">,
): WorkflowPresencePeer {
  return {
    name: "Teammate",
    color: "#D97757",
    selectedStepId: null,
    cursor: { x: 0, y: 0 },
    lastSeen: Date.now(),
    ...overrides,
  };
}

describe("WorkflowCursors", () => {
  it("renders nothing when no peer has a cursor", () => {
    const { container } = render(
      <WorkflowCursors
        peers={[peer({ userId: "u1", cursor: null })]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one cursor per peer with a non-null cursor position", () => {
    render(
      <WorkflowCursors
        peers={[
          peer({ userId: "u1", cursor: { x: 10, y: 20 } }),
          peer({ userId: "u2", cursor: { x: 30, y: 40 } }),
          peer({ userId: "u3", cursor: null }), // skipped
        ]}
      />,
    );
    expect(screen.getByTestId("workflow-cursor-u1")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-cursor-u2")).toBeInTheDocument();
    expect(screen.queryByTestId("workflow-cursor-u3")).toBeNull();
  });

  it("positions the cursor with a translate using canvas coords", () => {
    render(
      <WorkflowCursors
        peers={[peer({ userId: "u1", cursor: { x: 120, y: 240 } })]}
      />,
    );
    const el = screen.getByTestId("workflow-cursor-u1") as HTMLElement;
    expect(el.style.transform).toBe("translate(120px, 240px)");
  });

  it("uses the peer color for both the SVG fill and the name label", () => {
    render(
      <WorkflowCursors
        peers={[
          peer({
            userId: "u1",
            name: "Alex",
            color: "#7BA05B",
            cursor: { x: 0, y: 0 },
          }),
        ]}
      />,
    );
    const wrap = screen.getByTestId("workflow-cursor-u1");
    const svgPath = wrap.querySelector("svg path")!;
    expect(svgPath.getAttribute("fill")).toBe("#7BA05B");
    const label = wrap.querySelector("span") as HTMLElement;
    expect(label.textContent).toBe("Alex");
    expect(label.style.backgroundColor).toBe("rgb(123, 160, 91)");
  });

  it("filters out cursors with non-numeric coordinates defensively", () => {
    render(
      <WorkflowCursors
        peers={[
          peer({
            userId: "u1",
            // Simulate a malformed wire payload (server validates but
            // belt + suspenders — the renderer shouldn't crash).
            cursor: { x: Number.NaN, y: 10 } as unknown as { x: number; y: number },
          }),
        ]}
      />,
    );
    // Component should ignore NaN coords; we render nothing rather
    // than a NaN-translated cursor that disappears off the viewport.
    expect(screen.queryByTestId("workflow-cursor-u1")).toBeNull();
  });
});
