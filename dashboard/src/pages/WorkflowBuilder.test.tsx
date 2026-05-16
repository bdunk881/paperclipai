import type { ComponentType, ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import WorkflowBuilder from "./WorkflowBuilder";
import { generateWorkflow, getTemplate, listLLMConfigs, listRuns, listTemplates, startRunWithFile } from "../api/client";
import type { WorkflowStep } from "../types/workflow";

const requireAccessTokenMock = vi.fn();
const reactFlowPropsMock = vi.fn();

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  MiniMap: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  ReactFlow: ({
    children,
    nodes = [],
    nodeTypes = {},
    ...props
  }: {
    children?: ReactNode;
    nodes?: Array<{ id: string; type?: string; data?: unknown; selected?: boolean; dragging?: boolean }>;
    nodeTypes?: Record<string, ComponentType<Record<string, unknown>>>;
    [key: string]: unknown;
  }) => {
    reactFlowPropsMock({ nodes, nodeTypes, ...props });
    return (
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
    );
  },
}));

vi.mock("../api/client", () => ({
  listTemplates: vi.fn().mockResolvedValue([]),
  getTemplate: vi.fn(),
  listLLMConfigs: vi.fn().mockResolvedValue([]),
  listRuns: vi.fn().mockResolvedValue([]),
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

vi.mock("../api/workflowsApi", () => ({
  createCanonicalWorkflow: vi.fn(),
  createCanonicalWorkflowVersion: vi.fn(),
  listCanonicalWorkflowVersions: vi.fn().mockResolvedValue([]),
  getCanonicalWorkflowVersion: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    getAccessToken: vi.fn().mockResolvedValue("token-123"),
    requireAccessToken: requireAccessTokenMock,
  }),
}));

const listTemplatesMock = vi.mocked(listTemplates);
const listLLMConfigsMock = vi.mocked(listLLMConfigs);
const generateWorkflowMock = vi.mocked(generateWorkflow);
const startRunWithFileMock = vi.mocked(startRunWithFile);
const listRunsMock = vi.mocked(listRuns);
const getTemplateMock = vi.mocked(getTemplate);

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
  listRunsMock.mockResolvedValue([]);
  getTemplateMock.mockReset();
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

  it("renders the v2 left palette rail with Triggers / Tools / Logic sections", async () => {
    renderBuilder();

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    const palette = screen.getByTestId("studio-palette");
    expect(palette).toBeInTheDocument();

    // HEL-100 v2: three sections, derived from KIND_META, ordered
    // Triggers → Tools → Logic.
    expect(palette).toHaveTextContent("Triggers");
    expect(palette).toHaveTextContent("Tools");
    expect(palette).toHaveTextContent("Logic");

    // Spot-check one item per section reaches the rail.
    expect(palette).toHaveTextContent("Cron Trigger");
    expect(palette).toHaveTextContent("LLM");
    expect(palette).toHaveTextContent("Approval");
  });

  it("adds a step when a palette item is clicked", async () => {
    renderBuilder();

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    const palette = screen.getByTestId("studio-palette");

    // Click the Agent button in the Tools section; it should add an Agent
    // step (same handler as the popover-style AddStepMenu). Palette items
    // expose an aria-label of "Add {Label} step" to keep them disjoint
    // from the popover's exact-label buttons.
    fireEvent.click(within(palette).getByRole("button", { name: /Add Agent step/i }));

    expect(await screen.findByTestId("react-flow")).toBeInTheDocument();
    // "Agent Step" appears in both the canvas card and the inspector
    // header's serif title (HEL-100 v2 inspector chrome).
    expect(screen.getAllByText("Agent Step").length).toBeGreaterThan(0);
  });

  it("renders the v2 draft/version pill and a Pro mode pill toggle", async () => {
    renderBuilder();

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    // HEL-100 v2 chrome: when no team is deployed for this workflow, the
    // header shows a "draft · v{version}" pill (live · v{version} when
    // deployed). The default template version in this app is 1.0.0.
    expect(screen.getByLabelText("Workflow status")).toHaveTextContent(
      /draft · v1\.0\.0/i,
    );

    // Pro mode pill toggle: starts OFF, flips to ON on click. aria-pressed
    // and accessible label flip in lockstep with the visual state.
    const proToggle = screen.getByRole("button", { name: /Enable Pro mode/i });
    expect(proToggle).toHaveAttribute("aria-pressed", "false");
    expect(proToggle).toHaveTextContent(/Pro mode OFF/i);

    fireEvent.click(proToggle);

    const proToggleOn = screen.getByRole("button", { name: /Disable Pro mode/i });
    expect(proToggleOn).toHaveAttribute("aria-pressed", "true");
    expect(proToggleOn).toHaveTextContent(/Pro mode ON/i);
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
    // HEL-100 v2 inspector chrome: the step name now appears both in
    // the node card (canvas) and in the inspector header's serif title.
    expect(screen.getAllByText("Agent Step").length).toBeGreaterThan(0);
    expect(screen.getByText("Selected node")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/claude-sonnet-4-6/i)).toBeInTheDocument();
  });

  it("inspector header flips to 'Selected node · Pro' when Pro mode is on", async () => {
    renderBuilder();

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    openNodePalette();
    fireEvent.click(screen.getByRole("button", { name: /^agent$/i }));

    // Inspector opens with the basic eyebrow.
    expect(screen.getByText("Selected node")).toBeInTheDocument();
    expect(screen.queryByText(/Selected node · Pro/)).toBeNull();

    // Toggle Pro mode on; the eyebrow gains the " · Pro" suffix.
    fireEvent.click(screen.getByRole("button", { name: /Enable Pro mode/i }));
    expect(screen.getByText("Selected node · Pro")).toBeInTheDocument();
  });

  it("reveals Pro inspector tabs (Inspector / Versions / Observability) when Pro mode is on", async () => {
    renderBuilder();

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    openNodePalette();
    fireEvent.click(screen.getByRole("button", { name: /^agent$/i }));

    // No tabs visible before Pro mode is on.
    expect(screen.queryByRole("tab", { name: /Inspector/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Versions/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Observability/i })).toBeNull();

    // Toggle Pro mode on; tabs appear, Inspector is selected by default.
    fireEvent.click(screen.getByRole("button", { name: /Enable Pro mode/i }));

    expect(screen.getByRole("tab", { name: /Inspector/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /Versions/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: /Observability/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    // Click Versions — the Versions panel surfaces the current draft version.
    // "v1.0.0" also lives in the header pill ("draft · v1.0.0"), so scope
    // the version assertion to the panel.
    fireEvent.click(screen.getByRole("tab", { name: /Versions/i }));
    expect(screen.getByRole("tab", { name: /Versions/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const versionsPanel = document.getElementById(
      "pro-inspector-panel-versions",
    );
    expect(versionsPanel).not.toBeNull();
    expect(within(versionsPanel!).getByText(/v1\.0\.0/)).toBeInTheDocument();
    // This workflow has no canonicalWorkflowId (never been saved), so
    // the panel renders the draft state — a "draft" pill + a
    // "Save to start version history" hint.
    expect(within(versionsPanel!).getByText("draft")).toBeInTheDocument();
    expect(
      within(versionsPanel!).getByText(/Save to start version history/i),
    ).toBeInTheDocument();

    // Click Observability — the Observability panel surfaces stub
    // sections for latency, cost, errors.
    fireEvent.click(screen.getByRole("tab", { name: /Observability/i }));
    expect(screen.getByText(/Latency · p99/i)).toBeInTheDocument();
    expect(screen.getByText(/Cost · per run/i)).toBeInTheDocument();
    expect(screen.getByText(/Recent errors/i)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /^file trigger$/i }));

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

  it("Observability panel surfaces real p99 latency + cost stats + recent errors from runHistory", async () => {
    // Saved template with runs that have cost telemetry. One failed
    // run so the recent-errors list also has content. Pro mode + the
    // Observability tab pull from the same runHistory the canvas strip
    // uses, so no extra fetch is needed.
    getTemplateMock.mockResolvedValue({
      id: "tpl-obs",
      name: "Obs workflow",
      description: "",
      category: "support",
      version: "1.0.0",
      configFields: [],
      steps: [
        {
          id: "step-1",
          name: "Action",
          kind: "action",
          description: "",
          inputKeys: [],
          outputKeys: [],
          action: "noop",
        },
      ],
      sampleInput: {},
      expectedOutput: {},
    });
    listRunsMock.mockResolvedValue([
      {
        id: "run-1",
        templateId: "tpl-obs",
        templateName: "Obs workflow",
        status: "completed",
        startedAt: "2026-05-16T12:00:00.000Z",
        completedAt: "2026-05-16T12:00:01.000Z", // 1s
        input: {},
        stepResults: [
          {
            stepId: "step-1",
            stepName: "Action",
            status: "success",
            output: {},
            durationMs: 1000,
            costLog: { estimatedCostUsd: 0.05 },
          },
        ],
      },
      {
        id: "run-2",
        templateId: "tpl-obs",
        templateName: "Obs workflow",
        status: "completed",
        startedAt: "2026-05-16T12:01:00.000Z",
        completedAt: "2026-05-16T12:01:02.000Z", // 2s
        input: {},
        stepResults: [
          {
            stepId: "step-1",
            stepName: "Action",
            status: "success",
            output: {},
            durationMs: 2000,
            costLog: { estimatedCostUsd: 0.20 },
          },
        ],
      },
      {
        id: "run-3",
        templateId: "tpl-obs",
        templateName: "Obs workflow",
        status: "failed",
        startedAt: "2026-05-16T12:02:00.000Z",
        input: {},
        stepResults: [],
        error: "Apollo 429 — rate limited",
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/builder/tpl-obs"]}>
        <Routes>
          <Route path="/builder/:templateId" element={<WorkflowBuilder />} />
        </Routes>
      </MemoryRouter>,
    );

    // Wait for runHistory to populate (the canvas strip surfaces first).
    expect(await screen.findByText(/Last 3 runs/i)).toBeInTheDocument();

    // Select the canvas step so the inspector + Pro tabs render.
    // (Loaded templates don't auto-select a step the way addStep does.)
    fireEvent.click(screen.getAllByText("Action")[0]);

    // Flip Pro mode on + Observability tab.
    fireEvent.click(screen.getByRole("button", { name: /Enable Pro mode/i }));
    fireEvent.click(screen.getByRole("tab", { name: /Observability/i }));

    const obsPanel = document.getElementById(
      "pro-inspector-panel-observability",
    );
    expect(obsPanel).not.toBeNull();

    // Latency: durations [1000, 2000] → p50=1.0s, p99=2.0s, runs=2 completed.
    expect(within(obsPanel!).getByText("1.0s")).toBeInTheDocument();
    expect(within(obsPanel!).getByText("2.0s")).toBeInTheDocument();

    // Cost: per-run sums [$0.05, $0.20] → median $0.050, p99 $0.200.
    expect(within(obsPanel!).getByText("$0.050")).toBeInTheDocument();
    expect(within(obsPanel!).getByText("$0.200")).toBeInTheDocument();

    // Recent errors: the failed run surfaces with its error message.
    expect(
      within(obsPanel!).getByText(/Apollo 429 — rate limited/i),
    ).toBeInTheDocument();
  });

  it("renders the run-history strip with p50 / p99 / % ok stats when runs exist for a saved template", async () => {
    // Saved template (has an ID): the run-history strip should fetch
    // runs and render once they're loaded. Three runs in a known shape
    // so we can assert the rolled-up stats.
    getTemplateMock.mockResolvedValue({
      id: "tpl-existing",
      name: "Existing workflow",
      description: "",
      category: "support",
      version: "1.0.0",
      configFields: [],
      steps: [
        {
          id: "step-1",
          name: "Action step",
          kind: "action",
          description: "",
          inputKeys: [],
          outputKeys: [],
          action: "noop",
        },
      ],
      sampleInput: {},
      expectedOutput: {},
    });
    listRunsMock.mockResolvedValue([
      {
        id: "run-1",
        templateId: "tpl-existing",
        templateName: "Existing workflow",
        status: "completed",
        startedAt: "2026-05-16T12:00:00.000Z",
        completedAt: "2026-05-16T12:00:01.000Z", // 1s
        input: {},
        stepResults: [],
      },
      {
        id: "run-2",
        templateId: "tpl-existing",
        templateName: "Existing workflow",
        status: "completed",
        startedAt: "2026-05-16T12:01:00.000Z",
        completedAt: "2026-05-16T12:01:02.000Z", // 2s
        input: {},
        stepResults: [],
      },
      {
        id: "run-3",
        templateId: "tpl-existing",
        templateName: "Existing workflow",
        status: "failed",
        startedAt: "2026-05-16T12:02:00.000Z",
        input: {},
        stepResults: [],
        error: "boom",
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/builder/tpl-existing"]}>
        <Routes>
          <Route path="/builder/:templateId" element={<WorkflowBuilder />} />
        </Routes>
      </MemoryRouter>,
    );

    // Wait for the template + runs to load and the strip to surface.
    expect(await screen.findByText(/Last 3 runs/i)).toBeInTheDocument();

    // 2 of 3 (completed | failed) succeeded → 67% ok. p50 of [1s, 2s]
    // by nearest-rank with 50% = ceil(0.5*2)-1 = 0 → 1s. p99 → 2s.
    expect(screen.getByText(/p50 1\.0s · p99 2\.0s · 67% ok/i)).toBeInTheDocument();

    // requireAccessToken returns the token-123 from beforeEach, so the
    // run-history fetch passes that along.
    expect(listRunsMock).toHaveBeenCalledWith("tpl-existing", "token-123");
  });
});
