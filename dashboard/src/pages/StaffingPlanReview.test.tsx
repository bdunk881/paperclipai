import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import StaffingPlanReview from "./StaffingPlanReview";

const generateTeamAssemblyPlanMock = vi.fn();
const listCompanyRoleTemplatesMock = vi.fn();
const provisionCompanyWorkspaceMock = vi.fn();
const requireAccessTokenMock = vi.fn().mockResolvedValue("mock-token");

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    requireAccessToken: requireAccessTokenMock,
  }),
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual("../api/client");
  return {
    ...actual,
    generateTeamAssemblyPlan: (...args: unknown[]) => generateTeamAssemblyPlanMock(...args),
    listCompanyRoleTemplates: (...args: unknown[]) => listCompanyRoleTemplatesMock(...args),
    provisionCompanyWorkspace: (...args: unknown[]) => provisionCompanyWorkspaceMock(...args),
  };
});

describe("StaffingPlanReview", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAccessTokenMock.mockResolvedValue("mock-token");
    listCompanyRoleTemplatesMock.mockResolvedValue({
      roleTemplates: [
        {
          id: "ceo",
          name: "CEO",
          description: "Own strategy",
          defaultModel: "gpt-5.4",
          defaultInstructions: "Own strategy",
          defaultSkills: ["paperclip"],
        },
        {
          id: "frontend-engineer",
          name: "Frontend Engineer",
          description: "Build UI",
          defaultModel: "gpt-5.4",
          defaultInstructions: "Build UI",
          defaultSkills: ["frontend-design"],
        },
      ],
      total: 2,
      provisioningContract: {
        schemaVersion: "2026-04-28",
        endpoint: "/api/companies",
        requiredHeaders: ["X-Paperclip-Run-Id"],
        companyFields: { required: [], optional: [] },
        agentFields: {
          identifierFields: ["roleTemplateId", "roleKey"],
          requiredOneOf: ["roleKey"],
          optional: [],
        },
      },
    });

    generateTeamAssemblyPlanMock.mockResolvedValue({
      schemaVersion: "2026-04-27",
      company: {
        name: "LedgerPilot",
        goal: "Launch the product",
        targetCustomer: "Finance operators",
        budget: "$2400",
        timeHorizon: "90 days",
      },
      summary: "Lean launch team.",
      rationale: "Keep the team small and revenue-focused.",
      orgChart: {
        executives: [
          {
            roleKey: "ceo",
            title: "CEO",
            roleType: "executive",
            department: "executive",
            headcount: 1,
            reportsToRoleKey: null,
            mandate: "Own strategy",
            justification: "Cross-functional leader",
            kpis: ["Pipeline"],
            skills: ["paperclip"],
            tools: ["notion"],
            modelTier: "power",
            budgetMonthlyUsd: 1200,
            provisioningInstructions: "Provision CEO",
          },
        ],
        operators: [
          {
            roleKey: "frontend-engineer",
            title: "Frontend Engineer",
            roleType: "operator",
            department: "engineering",
            headcount: 1,
            reportsToRoleKey: "ceo",
            mandate: "Ship the dashboard",
            justification: "Customer-facing workflow",
            kpis: ["UI delivery"],
            skills: ["frontend-design"],
            tools: ["github"],
            modelTier: "standard",
            budgetMonthlyUsd: 1200,
            provisioningInstructions: "Provision FE",
          },
        ],
        reportingLines: [{ managerRoleKey: "ceo", reportRoleKey: "frontend-engineer" }],
      },
      provisioningPlan: {
        teamName: "LedgerPilot Launch Team",
        deploymentMode: "continuous_agents",
        agents: [
          {
            roleKey: "ceo",
            title: "CEO",
            roleType: "executive",
            department: "executive",
            headcount: 1,
            reportsToRoleKey: null,
            mandate: "Own strategy",
            justification: "Cross-functional leader",
            kpis: ["Pipeline"],
            skills: ["paperclip"],
            tools: ["notion"],
            modelTier: "power",
            budgetMonthlyUsd: 1200,
            provisioningInstructions: "Provision CEO",
          },
          {
            roleKey: "frontend-engineer",
            title: "Frontend Engineer",
            roleType: "operator",
            department: "engineering",
            headcount: 1,
            reportsToRoleKey: "ceo",
            mandate: "Ship the dashboard",
            justification: "Customer-facing workflow",
            kpis: ["UI delivery"],
            skills: ["frontend-design"],
            tools: ["github"],
            modelTier: "standard",
            budgetMonthlyUsd: 1200,
            provisioningInstructions: "Provision FE",
          },
        ],
      },
      roadmap306090: {
        day30: { objectives: ["Define scope"], deliverables: ["Plan"], ownerRoleKeys: ["ceo"] },
        day60: { objectives: ["Ship UI"], deliverables: ["Dashboard"], ownerRoleKeys: ["frontend-engineer"] },
        day90: { objectives: ["Launch"], deliverables: ["Preview"], ownerRoleKeys: ["ceo"] },
      },
    });

    provisionCompanyWorkspaceMock.mockResolvedValue({
      company: {
        id: "company-1",
        userId: "user-1",
        name: "LedgerPilot",
        workspaceId: "workspace-1",
        teamId: "team-1",
        idempotencyKey: "staffing-plan-1",
        budgetMonthlyUsd: 2400,
        allocatedBudgetMonthlyUsd: 2400,
        remainingBudgetMonthlyUsd: 0,
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
      workspace: {
        id: "workspace-1",
        name: "LedgerPilot Launch Team",
        slug: "ledgerpilot",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
      team: {
        id: "team-1",
        userId: "user-1",
        name: "LedgerPilot Launch Team",
        deploymentMode: "continuous_agents",
        budgetMonthlyUsd: 2400,
        orchestrationEnabled: true,
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
      agents: [],
      secretBindings: [],
      availableSkills: [],
      idempotentReplay: false,
    });
  });

  it("generates a staffing plan and approves it with the expected payload", async () => {
    render(
      <MemoryRouter initialEntries={["/workspace/staffing-plan"]}>
        <Routes>
          <Route path="/workspace/staffing-plan" element={<StaffingPlanReview />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(listCompanyRoleTemplatesMock).toHaveBeenCalled());
    await screen.findByText(/goal intake/i);

    fireEvent.change(screen.getByLabelText(/goal/i), {
      target: { value: "Launch the product" },
    });
    fireEvent.change(screen.getByLabelText(/company name/i), {
      target: { value: "LedgerPilot" },
    });

    fireEvent.click(screen.getByRole("button", { name: /generate staffing plan/i }));

    await screen.findByText(/ledgerpilot launch team/i);
    expect(generateTeamAssemblyPlanMock).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: "LedgerPilot Launch Team" },
    });
    fireEvent.change(screen.getByPlaceholderText("OPENAI_API_KEY"), {
      target: { value: "OPENAI_API_KEY" },
    });
    fireEvent.change(screen.getByPlaceholderText("sk-live-..."), {
      target: { value: "sk-test-1234" },
    });

    fireEvent.click(screen.getByRole("button", { name: /approve and provision/i }));

    await waitFor(() => expect(provisionCompanyWorkspaceMock).toHaveBeenCalled());
    expect(provisionCompanyWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "LedgerPilot",
        budgetMonthlyUsd: 2400,
        secretBindings: { OPENAI_API_KEY: "sk-test-1234" },
        agents: expect.arrayContaining([
          expect.objectContaining({ roleKey: "ceo" }),
          expect.objectContaining({ roleKey: "frontend-engineer" }),
        ]),
      }),
      "mock-token"
    );
  });
});
