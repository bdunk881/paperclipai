/**
 * HEL-822: WorkflowEnvironmentsPanel — deploy / rollback + env switch.
 * Mocks the workflowsApi client; asserts the calls + reload behavior.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-original";
import { WorkflowEnvironmentsPanel } from "./WorkflowEnvironmentsPanel";
import type {
  WorkflowDeployment,
  WorkflowDeploymentsResponse,
  CanonicalWorkflowVersionSummary,
} from "../../api/workflowsApi";

const listWorkflowDeployments = vi.fn();
const deployWorkflowVersion = vi.fn();
const rollbackWorkflowVersion = vi.fn();

vi.mock("../../api/workflowsApi", () => ({
  WORKFLOW_ENVIRONMENTS: ["dev", "staging", "prod"] as const,
  listWorkflowDeployments: (...a: unknown[]) => listWorkflowDeployments(...a),
  deployWorkflowVersion: (...a: unknown[]) => deployWorkflowVersion(...a),
  rollbackWorkflowVersion: (...a: unknown[]) => rollbackWorkflowVersion(...a),
}));

const WF = "wf-1";
const token = () => Promise.resolve("t");
const versions: CanonicalWorkflowVersionSummary[] = [
  { id: "ver-3", version: 3, createdAt: "2026-06-24T00:00:00Z", isLatest: true },
  { id: "ver-2", version: 2, createdAt: "2026-06-23T00:00:00Z", isLatest: false },
];

const dep = (over: Partial<WorkflowDeployment>): WorkflowDeployment => ({
  id: "d1",
  workflowId: WF,
  environment: "prod",
  versionId: "ver-2",
  version: 2,
  note: null,
  createdAt: "2026-06-23T01:00:00Z",
  createdByUserId: null,
  ...over,
});

function mockDeployments(over?: Partial<WorkflowDeploymentsResponse>) {
  listWorkflowDeployments.mockResolvedValue({
    workflowId: WF,
    deployments: [],
    current: { dev: null, staging: null, prod: null },
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeployments();
  deployWorkflowVersion.mockResolvedValue(dep({}));
  rollbackWorkflowVersion.mockResolvedValue(dep({}));
});

describe("WorkflowEnvironmentsPanel (HEL-822)", () => {
  it("prompts to save when there is no workflow id", () => {
    render(<WorkflowEnvironmentsPanel workflowId={null} getAccessToken={token} versions={versions} />);
    expect(screen.getByText(/Save this workflow/i)).toBeTruthy();
  });

  it("loads deployments and shows the current version per env", async () => {
    mockDeployments({ current: { dev: dep({ version: 3 }), staging: null, prod: dep({ version: 2 }) } });
    render(<WorkflowEnvironmentsPanel workflowId={WF} getAccessToken={token} versions={versions} />);
    await waitFor(() => expect(listWorkflowDeployments).toHaveBeenCalledWith(WF, "t"));
    expect(screen.getByText(/Deployed to/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Deploy draft \(v3\) to dev/i })).toBeTruthy();
  });

  it("deploys the draft (latest version) to the selected environment", async () => {
    render(<WorkflowEnvironmentsPanel workflowId={WF} getAccessToken={token} versions={versions} />);
    await waitFor(() => expect(listWorkflowDeployments).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Deploy draft \(v3\) to dev/i }));
    await waitFor(() => expect(deployWorkflowVersion).toHaveBeenCalledWith(WF, "dev", "ver-3", "t"));
    await waitFor(() => expect(listWorkflowDeployments).toHaveBeenCalledTimes(2)); // reload
  });

  it("switches environment and deploys to prod", async () => {
    render(<WorkflowEnvironmentsPanel workflowId={WF} getAccessToken={token} versions={versions} />);
    await waitFor(() => expect(listWorkflowDeployments).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("tab", { name: /prod/i }));
    fireEvent.click(screen.getByRole("button", { name: /Deploy draft \(v3\) to prod/i }));
    await waitFor(() => expect(deployWorkflowVersion).toHaveBeenCalledWith(WF, "prod", "ver-3", "t"));
  });

  it("rolls back a non-current deployment", async () => {
    const curDep = dep({ id: "cur", environment: "dev", version: 3, versionId: "ver-3" });
    mockDeployments({
      deployments: [curDep, dep({ id: "old", environment: "dev", version: 1, versionId: "ver-1" })],
      current: { dev: curDep, staging: null, prod: null },
    });
    render(<WorkflowEnvironmentsPanel workflowId={WF} getAccessToken={token} versions={versions} />);
    await waitFor(() => expect(screen.getByText(/deployment history/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Roll back/i }));
    await waitFor(() => expect(rollbackWorkflowVersion).toHaveBeenCalledWith(WF, "dev", "ver-1", "t"));
  });
});
