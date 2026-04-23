import type { ComponentType, ReactNode } from "react";
<<<<<<< HEAD
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
=======
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
>>>>>>> 18bf559 (test(dashboard): finish ALT-1589 coverage gate)
import { MemoryRouter, Route, Routes } from "react-router-dom";
import WorkflowBuilder from "./WorkflowBuilder";

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  ReactFlow: ({
    children,
    nodes = [],
    nodeTypes = {},
  }: {
    children?: ReactNode;
    nodes?: Array<{ id: string; type?: string; data?: unknown; selected?: boolean; dragging?: boolean }>;
    nodeTypes?: Record<string, ComponentType<Record<string, unknown>>>;
  }) => (
    <div data-testid="react-flow">
      {nodes.map((node) => {
        const NodeComponent = node.type ? nodeTypes[node.type] : undefined;
        if (!NodeComponent) return null;
        return (
          <NodeComponent
            key={node.id}
            id={node.id}
            data={node.data}
            selected={Boolean(node.selected)}
            dragging={Boolean(node.dragging)}
          />
        );
      })}
      {children}
    </div>
  ),
}));

vi.mock("../api/client", () => ({
  listTemplates: vi.fn().mockResolvedValue([]),
  getTemplate: vi.fn(),
  listLLMConfigs: vi.fn().mockResolvedValue([]),
  startRun: vi.fn(),
  startRunWithFile: vi.fn(),
  generateWorkflow: vi.fn(),
  createTemplate: vi.fn(),
}));

describe("WorkflowBuilder", () => {
  it("opens and closes the guidance panel", async () => {
    render(
      <MemoryRouter initialEntries={["/builder"]}>
        <Routes>
          <Route path="/builder" element={<WorkflowBuilder />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /guidance/i }));
    expect(screen.getByText("Build and launch confidently")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Build and launch confidently")).toBeNull();
  });

  it("skips invalid auto-links when adding a step after an output", async () => {
    render(
      <MemoryRouter initialEntries={["/builder"]}>
        <Routes>
          <Route path="/builder" element={<WorkflowBuilder />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /node palette/i }));
    fireEvent.click(screen.getByRole("button", { name: /^output$/i }));

    fireEvent.click(screen.getByRole("button", { name: /node palette/i }));
    fireEvent.click(screen.getByRole("button", { name: /^action$/i }));

    expect(await screen.findByText("Output steps cannot connect to another step.")).toBeInTheDocument();
  });

  it("renders a newly added agent step inside the React Flow canvas", async () => {
<<<<<<< HEAD
    renderBuilder();

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    openNodePalette();
    fireEvent.click(screen.getByRole("button", { name: /^agent$/i }));

    expect(await screen.findByTestId("react-flow")).toBeInTheDocument();
    expect(screen.getByText("Agent Step")).toBeInTheDocument();
    expect(screen.getByText("Step Properties")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/claude-sonnet-4-6/i)).toBeInTheDocument();
  });

  it("uses copilot to explain the canvas and apply a targeted slack step", async () => {
    renderBuilder();
=======
    render(
      <MemoryRouter initialEntries={["/builder"]}>
        <Routes>
          <Route path="/builder" element={<WorkflowBuilder />} />
        </Routes>
      </MemoryRouter>
    );
>>>>>>> 18bf559 (test(dashboard): finish ALT-1589 coverage gate)

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /node palette/i }));
    fireEvent.click(screen.getByRole("button", { name: /^agent$/i }));

    expect(await screen.findByTestId("react-flow")).toBeInTheDocument();
    expect(screen.getByText("Agent Step")).toBeInTheDocument();
    expect(screen.getByText("Step Properties")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/claude-sonnet-4-6/i)).toBeInTheDocument();
  });
});
