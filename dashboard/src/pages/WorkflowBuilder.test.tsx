import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import WorkflowBuilder from "./WorkflowBuilder";
import { generateWorkflow, listLLMConfigs, listTemplates, startRunWithFile } from "../api/client";
import type { WorkflowStep } from "../types/workflow";

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  ReactFlow: ({ children }: { children?: React.ReactNode }) => <div data-testid="react-flow">{children}</div>,
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
});
