/**
 * PresenceStack tests — HEL-241C.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react-original";
import { PresenceStack } from "./PresenceStack";
import type { WorkflowPresencePeer } from "../../api/workflowsApi";

function peer(overrides: Partial<WorkflowPresencePeer> & Pick<WorkflowPresencePeer, "userId">): WorkflowPresencePeer {
  return {
    name: "Teammate",
    color: "#000000",
    selectedStepId: null,
    lastSeen: Date.now(),
    ...overrides,
  };
}

describe("PresenceStack", () => {
  it("renders nothing when there are no peers", () => {
    const { container } = render(<PresenceStack peers={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one avatar circle per peer, showing the first initial", () => {
    render(
      <PresenceStack
        peers={[
          peer({ userId: "u1", name: "Alex" }),
          peer({ userId: "u2", name: "Bryan" }),
        ]}
      />,
    );
    const dots = screen.getByTestId("workflow-presence-stack").querySelectorAll("span");
    // 2 PeerDots, no overflow pill.
    expect(dots).toHaveLength(2);
    expect(dots[0].textContent).toBe("A");
    expect(dots[1].textContent).toBe("B");
  });

  it("collapses peers past MAX_VISIBLE into a +N pill", () => {
    const peers: WorkflowPresencePeer[] = Array.from({ length: 7 }, (_, i) =>
      peer({ userId: `u${i}`, name: `User${i}` }),
    );
    render(<PresenceStack peers={peers} />);
    const stack = screen.getByTestId("workflow-presence-stack");
    const dots = stack.querySelectorAll("span");
    // 4 visible + 1 overflow pill = 5
    expect(dots).toHaveLength(5);
    expect(dots[4].textContent).toBe("+3");
  });

  it("includes the focused step name in the avatar tooltip when known", () => {
    render(
      <PresenceStack
        peers={[peer({ userId: "u1", name: "Alex", selectedStepId: "step-x" })]}
        stepNames={{ "step-x": "Ask AI" }}
      />,
    );
    const dot = screen.getByTestId("workflow-presence-stack").querySelector("span")!;
    expect(dot.getAttribute("title")).toBe("Alex — viewing Ask AI");
  });

  it("uses the peer color as the avatar background", () => {
    render(
      <PresenceStack peers={[peer({ userId: "u1", name: "Alex", color: "#D97757" })]} />,
    );
    const dot = screen.getByTestId("workflow-presence-stack").querySelector("span")!;
    expect((dot as HTMLElement).style.backgroundColor).toBe("rgb(217, 119, 87)");
  });
});
