import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateSummary } from "../api/client";
import Templates from "./Templates";

const { listTemplatesMock } = vi.hoisted(() => ({
  listTemplatesMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  listTemplates: listTemplatesMock,
}));

function makeTemplate(overrides: Partial<TemplateSummary> = {}): TemplateSummary {
  return {
    id: "tpl-1",
    name: "My Template",
    description: "A description",
    category: "ops",
    version: "1.0",
    stepCount: 3,
    configFieldCount: 2,
    ...overrides,
  };
}

function renderTemplates(props: { initialTemplates?: TemplateSummary[] } = {}) {
  return render(
    <MemoryRouter>
      <Templates {...props} />
    </MemoryRouter>
  );
}

describe("Templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // initialTemplates prop path (no API call)
  // ---------------------------------------------------------------------------

  it("renders templates from initialTemplates without calling the API", () => {
    const templates = [makeTemplate({ id: "t1", name: "Alpha Workflow" })];
    renderTemplates({ initialTemplates: templates });

    expect(screen.getByText("Alpha Workflow")).toBeInTheDocument();
    expect(listTemplatesMock).not.toHaveBeenCalled();
  });

  it("starts in non-loading state when initialTemplates is provided", () => {
    renderTemplates({ initialTemplates: [] });
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Loading / error paths (no initialTemplates)
  // ---------------------------------------------------------------------------

  it("shows loading state while fetching", () => {
    listTemplatesMock.mockReturnValue(new Promise(() => {}));
    renderTemplates();
    expect(screen.getByText(/loading workflow templates/i)).toBeInTheDocument();
  });

  it("shows error state when fetch rejects with an Error", async () => {
    listTemplatesMock.mockRejectedValueOnce(new Error("network error"));
    renderTemplates();
    await waitFor(() => expect(screen.getByText(/templates unavailable/i)).toBeInTheDocument());
    expect(screen.getByText("network error")).toBeInTheDocument();
  });

  it("shows fallback error message when fetch rejects with a non-Error", async () => {
    listTemplatesMock.mockRejectedValueOnce("oops");
    renderTemplates();
    await waitFor(() => expect(screen.getByText(/failed to load templates/i)).toBeInTheDocument());
  });

  it("renders fetched templates after successful load", async () => {
    listTemplatesMock.mockResolvedValueOnce([makeTemplate({ name: "Remote Template" })]);
    renderTemplates();
    await waitFor(() => expect(screen.getByText("Remote Template")).toBeInTheDocument());
  });

  // ---------------------------------------------------------------------------
  // Filtering — category
  // ---------------------------------------------------------------------------

  it("shows all templates when 'All' category is selected (default)", () => {
    const templates = [
      makeTemplate({ id: "t1", name: "Ops Work", category: "ops" }),
      makeTemplate({ id: "t2", name: "Sales Work", category: "sales" }),
    ];
    renderTemplates({ initialTemplates: templates });
    expect(screen.getByText("Ops Work")).toBeInTheDocument();
    expect(screen.getByText("Sales Work")).toBeInTheDocument();
  });

  it("filters to selected category", async () => {
    const templates = [
      makeTemplate({ id: "t1", name: "Ops Work", category: "ops" }),
      makeTemplate({ id: "t2", name: "Sales Work", category: "sales" }),
    ];
    renderTemplates({ initialTemplates: templates });

    await userEvent.click(screen.getByRole("button", { name: /ops/i }));

    expect(screen.getByText("Ops Work")).toBeInTheDocument();
    expect(screen.queryByText("Sales Work")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Filtering — query
  // ---------------------------------------------------------------------------

  it("filters by name match", async () => {
    const templates = [
      makeTemplate({ id: "t1", name: "Alpha Workflow", description: "desc1", category: "ops" }),
      makeTemplate({ id: "t2", name: "Beta Workflow", description: "desc2", category: "ops" }),
    ];
    renderTemplates({ initialTemplates: templates });

    await userEvent.type(screen.getByPlaceholderText(/search templates/i), "alpha");

    expect(screen.getByText("Alpha Workflow")).toBeInTheDocument();
    expect(screen.queryByText("Beta Workflow")).not.toBeInTheDocument();
  });

  it("filters by description match", async () => {
    const templates = [
      makeTemplate({ id: "t1", name: "Work A", description: "special desc", category: "ops" }),
      makeTemplate({ id: "t2", name: "Work B", description: "other text", category: "ops" }),
    ];
    renderTemplates({ initialTemplates: templates });

    await userEvent.type(screen.getByPlaceholderText(/search templates/i), "special");

    expect(screen.getByText("Work A")).toBeInTheDocument();
    expect(screen.queryByText("Work B")).not.toBeInTheDocument();
  });

  it("filters by category name match in query", async () => {
    const templates = [
      makeTemplate({ id: "t1", name: "Work A", description: "desc", category: "support" }),
      makeTemplate({ id: "t2", name: "Work B", description: "desc", category: "sales" }),
    ];
    renderTemplates({ initialTemplates: templates });

    await userEvent.type(screen.getByPlaceholderText(/search templates/i), "support");

    expect(screen.getByText("Work A")).toBeInTheDocument();
    expect(screen.queryByText("Work B")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  it("shows empty state when no templates match the filter", async () => {
    const templates = [makeTemplate({ name: "Alpha Workflow", category: "ops" })];
    renderTemplates({ initialTemplates: templates });

    await userEvent.type(screen.getByPlaceholderText(/search templates/i), "zzz-no-match");

    expect(screen.getByText(/no templates match this filter/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Description fallback
  // ---------------------------------------------------------------------------

  it("shows fallback text for templates with empty description", () => {
    const templates = [makeTemplate({ description: "" })];
    renderTemplates({ initialTemplates: templates });
    expect(screen.getByText(/no description provided/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // v2 structural marker regression guard (HEL-65)
  // ---------------------------------------------------------------------------

  it("renders with v2 structural markers (HEL-65)", () => {
    const templates = [makeTemplate({ name: "Marker Template" })];
    const { container } = renderTemplates({ initialTemplates: templates });

    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector(".af2-eyebrow")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
    expect(container.querySelector(".af2-tabs")).not.toBeNull();
    expect(container.querySelectorAll(".af2-card").length).toBeGreaterThan(0);
  });
});
