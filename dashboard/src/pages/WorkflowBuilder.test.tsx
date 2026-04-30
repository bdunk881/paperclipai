import type { ComponentType, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import WorkflowBuilder from "./WorkflowBuilder";
import { generateWorkflow, getTemplate, listLLMConfigs, listTemplates, startRunWithFile } from "../api/client";
import type { WorkflowStep, WorkflowTemplate } from "../types/workflow";

const requireAccessTokenMock = vi.fn();

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
  deployWorkflowAsTeam: vi.fn().mockResolvedValue({
    team: { id: "team-1", name: "Support Team" },
    agents: [],
    workflow: { id: "tpl-1", name: "Support Flow", category: "support", version: "1.0.0" },
  }),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    getAccessToken: vi.fn().mockResolvedValue("token-123"),
    requireAccessToken: requireAccessTokenMock,
  }),
}));

const listTemplatesMock = vi.mocked(listTemplates);
const getTemplateMock = vi.mocked(getTemplate);
const listLLMConfigsMock = vi.mocked(listLLMConfigs);
const generateWorkflowMock = vi.mocked(generateWorkflow);
const startRunWithFileMock = vi.mocked(startRunWithFile);

const TEMPLATE_FIXTURE: WorkflowTemplate = {
  id: "tpl-1",
  name: "Support triage",
  description: "Assist inbound support triage.",
  category: "support",
  version: "1.0.0",
  configFields: [],
  steps: [],
  sampleInput: {},
  expectedOutput: {},
};

function renderBuilder(entry = "/builder", routePath = "/builder") {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path={routePath} element={<WorkflowBuilder />} />
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
  getTemplateMock.mockReset();
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

  it("renders a newly added agent step inside the React Flow canvas", async () => {
    renderBuilder();

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    openNodePalette();
    fireEvent.click(screen.getByRole("button", { name: /^agent$/i }));

    expect(await screen.findByTestId("react-flow")).toBeInTheDocument();
    expect(screen.getByText("Agent Step")).toBeInTheDocument();
    expect(screen.getByText("Step Properties")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/claude-sonnet-4-6/i)).toBeInTheDocument();
  });

  it("opens the deploy as team modal for populated workflows", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /deploy workflow as agent team/i }));

    expect(screen.getByText(/promote this workflow into a live agent roster/i)).toBeInTheDocument();
    expect(screen.getByText(/team preview/i)).toBeInTheDocument();
  });

  it("renders cron trigger fields and a live schedule preview", async () => {
    render(
      <MemoryRouter initialEntries={["/builder"]}>
        <Routes>
          <Route path="/builder" element={<WorkflowBuilder />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /node palette/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cron trigger$/i }));

    const cronField = screen.getByLabelText("Cron Expression");
    fireEvent.change(cronField, { target: { value: "0 9 * * 1" } });

    expect(screen.getByDisplayValue("UTC")).toBeInTheDocument();
    expect(screen.getByText(/standard crontab format/i)).toBeInTheDocument();
    expect(screen.getByText("Runs every Monday at 9:00 AM UTC")).toBeInTheDocument();
  });

  it("shows an error for invalid cron expressions", async () => {
    render(
      <MemoryRouter initialEntries={["/builder"]}>
        <Routes>
          <Route path="/builder" element={<WorkflowBuilder />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /node palette/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cron trigger$/i }));
    fireEvent.change(screen.getByLabelText("Cron Expression"), { target: { value: "bad cron" } });

    expect(screen.getByText("Invalid cron expression. Please check the syntax.")).toBeInTheDocument();
  });

  it("shows an error when interval minutes are not positive", async () => {
    render(
      <MemoryRouter initialEntries={["/builder"]}>
        <Routes>
          <Route path="/builder" element={<WorkflowBuilder />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /node palette/i }));
    fireEvent.click(screen.getByRole("button", { name: /^interval trigger$/i }));
    fireEvent.change(screen.getByLabelText("Interval (Minutes)"), { target: { value: "0" } });

    expect(screen.getByText("Interval must be a positive integer.")).toBeInTheDocument();
    expect(screen.getByText("How often the workflow should execute.")).toBeInTheDocument();
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
      expect(startRunWithFileMock).toHaveBeenCalledWith(expect.any(String), file, undefined, "token-123");
    });
    expect(await screen.findByText(/run started — redirecting to monitor/i)).toBeInTheDocument();
  });

  it("shows explicit read-only state for pop-out builder routes", async () => {
    getTemplateMock.mockResolvedValue({
      ...TEMPLATE_FIXTURE,
      steps: [
        {
          id: "step-1",
          name: "Triage",
          kind: "trigger",
          description: "Start the workflow.",
          inputKeys: [],
          outputKeys: ["payload"],
        },
      ],
    });

    renderBuilder("/builder/tpl-1?popout=1&mode=readonly&from=%2Fhistory", "/builder/:templateId");

    expect(await screen.findByRole("heading", { name: "Support triage" })).toBeInTheDocument();
    expect(screen.getAllByText("Read-only")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /^read-only$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /generate with ai/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /copilot/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /node palette/i })).toBeDisabled();
    expect(document.title).toContain("Read-only workflow");
  });

  it("renders the pop-out failure state with a back action", async () => {
    getTemplateMock.mockRejectedValue(new Error("Template not found: missing-template"));

    renderBuilder("/builder/missing-template?popout=1&from=%2Fhistory", "/builder/:templateId");

    expect(
      await screen.findByRole("heading", { name: /this workflow cannot be loaded right now/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back to workflows/i })).toBeInTheDocument();
    expect(document.title).toContain("Workflow unavailable");
  });
});
