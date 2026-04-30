import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import WorkflowBuilder from "./WorkflowBuilder";
import { generateWorkflow, listLLMConfigs, listTemplates, startRunWithFile } from "../api/client";
import type { WorkflowStep } from "../types/workflow";

const requireAccessTokenMock = vi.fn();
const reactFlowPropsMock = vi.fn();

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  ReactFlow: ({ children, ...props }: { children?: React.ReactNode }) => {
    reactFlowPropsMock(props);
    return <div data-testid="react-flow">{children}</div>;
  },
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

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    requireAccessToken: requireAccessTokenMock,
  }),
}));

const listTemplatesMock = vi.mocked(listTemplates);
const listLLMConfigsMock = vi.mocked(listLLMConfigs);
const generateWorkflowMock = vi.mocked(generateWorkflow);
const startRunWithFileMock = vi.mocked(startRunWithFile);

function renderBuilder() {
  render(
    <MemoryRouter initialEntries={["/builder"]}>
      <Routes>
        <Route path="/builder" element={<WorkflowBuilder />} />
      </Routes>
    </MemoryRouter>
  );
}

function openNodePalette() {
  fireEvent.click(screen.getByRole("button", { name: /node palette/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAccessTokenMock.mockResolvedValue("token-123");
  listTemplatesMock.mockResolvedValue([]);
  listLLMConfigsMock.mockResolvedValue([]);
  generateWorkflowMock.mockReset();
  startRunWithFileMock.mockReset();
});

describe("WorkflowBuilder", () => {
  it("opens and closes the guidance panel", async () => {
    renderBuilder();

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /guidance/i }));
    expect(screen.getByText("Build and launch confidently")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Build and launch confidently")).toBeNull();
  });

  it("skips invalid auto-links when adding a step after an output", async () => {
    renderBuilder();

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    openNodePalette();
    fireEvent.click(screen.getByRole("button", { name: /^output$/i }));

    openNodePalette();
    fireEvent.click(screen.getByRole("button", { name: /^action$/i }));

    expect(await screen.findByText("Output steps cannot connect to another step.")).toBeInTheDocument();
  });

  it("uses copilot to explain the canvas and apply a targeted slack step", async () => {
    renderBuilder();

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    openNodePalette();
    fireEvent.click(screen.getByRole("button", { name: /^trigger$/i }));

    fireEvent.click(screen.getByRole("button", { name: /copilot/i }));

    const copilotInput = screen.getByLabelText(/ask copilot/i);
    fireEvent.change(copilotInput, { target: { value: "explain this workflow" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect((await screen.findAllByText(/this workflow contains 1 step/i)).length).toBeGreaterThan(0);

    fireEvent.change(copilotInput, { target: { value: "add slack notification" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect(
      (await screen.findAllByText(/i prepared a targeted canvas change based on your instruction/i)).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(/proposed change · send slack notification/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    expect((await screen.findAllByText(/applied to the canvas/i)).length).toBeGreaterThan(0);

    fireEvent.change(copilotInput, { target: { value: "explain this workflow" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect((await screen.findAllByText(/this workflow contains 2 steps/i)).length).toBeGreaterThan(0);
  });

  it("generates a workflow from the AI modal and applies the preview to the canvas", async () => {
    const generatedSteps: WorkflowStep[] = [
      {
        id: "step-email",
        name: "Send email update",
        kind: "action",
        description: "Send an outbound email from the workflow.",
        inputKeys: ["subject", "body"],
        outputKeys: ["deliveryStatus"],
        action: "email.send",
      },
      {
        id: "step-approval",
        name: "Approval gate",
        kind: "approval",
        description: "Pause for human approval before the workflow continues.",
        inputKeys: ["approvalRequest"],
        outputKeys: ["approvalDecision"],
        approvalTimeoutMinutes: 60,
      },
    ];
    generateWorkflowMock.mockResolvedValue(generatedSteps);

    renderBuilder();

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
    fireEvent.change(screen.getByPlaceholderText(/when a customer support email arrives/i), {
      target: { value: "Email the customer and require manager approval" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate workflow/i }));

    expect(await screen.findByText(/preview — 2 steps suggested/i)).toBeInTheDocument();
    expect(screen.getByText("Send email update")).toBeInTheDocument();
    expect(screen.getByText("Approval gate")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /apply to canvas/i }));

    await waitFor(() => {
      expect(screen.queryByText(/generate workflow with ai/i)).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /copilot/i }));
    const copilotInput = screen.getByLabelText(/ask copilot/i);
    fireEvent.change(copilotInput, { target: { value: "explain this workflow" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    expect((await screen.findAllByText(/this workflow contains 2 steps/i)).length).toBeGreaterThan(0);
  });

  it("opens the file upload modal for file triggers and starts a file-backed run", async () => {
    startRunWithFileMock.mockResolvedValue(undefined);
    renderBuilder();

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    openNodePalette();
    fireEvent.click(screen.getByRole("button", { name: /file trigger/i }));

    fireEvent.change(screen.getByPlaceholderText(/\.pdf, \.png, \.jpg, \.mp3, \.wav/i), {
      target: { value: ".csv, .pdf" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    expect(await screen.findByText(/upload file to run workflow/i)).toBeInTheDocument();

    const file = new File(["name,email\nAda,ada@example.com"], "leads.csv", { type: "text/csv" });
    const fileInput = document.getElementById("file-upload-input") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole("button", { name: /run with file/i }));

    await waitFor(() => {
      expect(startRunWithFileMock).toHaveBeenCalledWith(expect.any(String), file);
    });
    expect(await screen.findByText(/run started — redirecting to monitor/i)).toBeInTheDocument();
  });

  it("renders the template list inside a scrollable panel when templates are available", async () => {
    listTemplatesMock.mockResolvedValue([
      { id: "tpl-1", name: "Support triage", description: "", category: "support", version: "1.0.0" },
      { id: "tpl-2", name: "Lead routing", description: "", category: "sales", version: "1.0.0" },
      { id: "tpl-3", name: "Escalations", description: "", category: "support", version: "1.0.0" },
    ]);

    renderBuilder();

    const templatePanel = await screen.findByLabelText(/workflow templates/i);
    expect(templatePanel.className).toContain("max-h-[min(40vh,26rem)]");
    expect(templatePanel.className).toContain("overflow-y-auto");
  });

  it("updates node positions continuously while dragging", async () => {
    renderBuilder();

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    openNodePalette();
    fireEvent.click(screen.getByRole("button", { name: /^trigger$/i }));

    await waitFor(() => {
      expect(reactFlowPropsMock).toHaveBeenCalled();
    });

    const latestProps = reactFlowPropsMock.mock.calls.at(-1)?.[0] as {
      nodes: Array<{ id: string; position: { x: number; y: number } }>;
      onNodeDrag?: (_event: unknown, node: { id: string; position: { x: number; y: number } }) => void;
    };

    expect(latestProps.onNodeDrag).toBeTypeOf("function");
    await act(async () => {
      latestProps.onNodeDrag?.(undefined, {
        id: latestProps.nodes[0].id,
        position: { x: 240, y: 320 },
      });
    });

    await waitFor(() => {
      const updatedProps = reactFlowPropsMock.mock.calls.at(-1)?.[0] as {
        nodes: Array<{ id: string; position: { x: number; y: number } }>;
      };
      expect(updatedProps.nodes[0].position).toEqual({ x: 240, y: 320 });
    });
  });
});
