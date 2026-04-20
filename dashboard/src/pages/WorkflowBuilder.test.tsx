import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    children?: React.ReactNode;
    nodes?: Array<{ id: string; type?: string; data?: unknown; selected?: boolean; dragging?: boolean }>;
    nodeTypes?: Record<string, (props: Record<string, unknown>) => JSX.Element>;
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
            selected={node.selected}
            dragging={node.dragging}
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

  it("renders modular agent slots for empty and populated states", async () => {
    render(
      <MemoryRouter initialEntries={["/builder"]}>
        <Routes>
          <Route path="/builder" element={<WorkflowBuilder />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /node palette/i }));
    fireEvent.click(screen.getByRole("button", { name: /^agent$/i }));

    expect(await screen.findByText("Modular Attachments")).toBeInTheDocument();
    expect(screen.getAllByText("Model").length).toBeGreaterThan(0);
    expect(screen.getByText("Attach memory")).toBeInTheDocument();
    expect(screen.getByText("Attach tools")).toBeInTheDocument();
    expect(screen.getAllByText("Empty")).toHaveLength(3);

    fireEvent.click(screen.getByText("Agent Step"));

    fireEvent.change(screen.getByPlaceholderText(/claude-sonnet-4-6/i), {
      target: { value: "gpt-5.4-mini" },
    });

    expect(await screen.findByText("gpt-5.4-mini")).toBeInTheDocument();
    expect(screen.getByText("Primary reasoning layer")).toBeInTheDocument();
  });
});
