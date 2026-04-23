import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AgentDeploy from "./AgentDeploy";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "u@e.com", name: "U" },
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue("mock-token"),
  }),
}));

vi.mock("../data/agentMarketplaceData", () => ({
  getAgentTemplate: (id: string) =>
    id === "test-tpl"
      ? {
          id: "test-tpl",
          name: "Test Agent",
          category: "Engineering",
          description: "desc",
          capabilities: ["c1"],
          requiredIntegrations: ["GitHub"],
          optionalIntegrations: ["Notion"],
          pricingTier: "Starter",
          monthlyPriceUsd: 29,
        }
      : null,
  createDeployment: vi.fn(),
}));

function renderDeploy(id = "test-tpl") {
  return render(
    <MemoryRouter initialEntries={[`/agents/deploy/${id}`]}>
      <Routes>
        <Route path="/agents/deploy/:templateId" element={<AgentDeploy />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AgentDeploy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ connections: [] }), { status: 200 })
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows not-found for missing template", () => {
    renderDeploy("no-such");
    expect(screen.getByText(/agent template not found/i)).toBeInTheDocument();
  });

  it("renders form, toggles, and validates before deploy", async () => {
    renderDeploy();

    // Form renders
    await waitFor(() => expect(screen.getByText("Deploy Test Agent")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Test Agent Instance")).toBeInTheDocument();

    // Permission toggle
    const writeCb = screen.getByText("write").closest("label")!.querySelector("input")!;
    expect(writeCb.checked).toBe(false);
    fireEvent.click(writeCb);
    expect(writeCb.checked).toBe(true);

    // Required integration locked — find integration checkboxes (labels with checkboxes)
    const integrationLabels = screen.getAllByText("GitHub");
    const ghLabel = integrationLabels.find((el) => el.closest("label")?.querySelector("input[type='checkbox']"));
    const ghCb = ghLabel?.closest("label")?.querySelector("input")!;
    expect(ghCb.disabled).toBe(true);
    expect(ghCb.checked).toBe(true);

    // Optional integration toggleable
    const notionLabels = screen.getAllByText("Notion");
    const notionLabel = notionLabels.find((el) => el.closest("label")?.querySelector("input[type='checkbox']"));
    const notionCb = notionLabel?.closest("label")?.querySelector("input")!;
    fireEvent.click(notionCb);
    expect(notionCb.checked).toBe(true);

    // Empty name blocks submit
    fireEvent.change(screen.getByDisplayValue("Test Agent Instance"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Deploy agent"));
    expect(screen.queryByText("Deploying...")).not.toBeInTheDocument();

    // Restore name, remove permissions blocks submit
    fireEvent.change(screen.getByDisplayValue(""), { target: { value: "My Agent" } });
    fireEvent.click(screen.getByText("read").closest("label")!.querySelector("input")!);
    fireEvent.click(screen.getByText("execute").closest("label")!.querySelector("input")!);
    fireEvent.click(screen.getByText("Deploy agent"));
    expect(screen.queryByText("Deploying...")).not.toBeInTheDocument();
  });

  it("shows OAuth error when provider required but not connected", async () => {
    renderDeploy();
    await waitFor(() => expect(screen.getByText("Deploy Test Agent")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Deploy agent"));
    await waitFor(() => expect(screen.getByText(/must be connected before deployment/)).toBeInTheDocument());
  });

  it("displays connected providers from API", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ connections: [{ provider: "github", accountLabel: "org" }] }), { status: 200 })
    );
    renderDeploy();
    await waitFor(() => expect(screen.getByText("Connected as org")).toBeInTheDocument());
  });

  it("handles connection load failure", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("Load fail"));
    renderDeploy();
    await waitFor(() => expect(screen.getByText("Load fail")).toBeInTheDocument());
  });
});
