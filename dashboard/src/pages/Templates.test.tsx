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
  // v2 chrome — eyebrow, h1, page-head meta, action buttons
  // ---------------------------------------------------------------------------

  it("renders the v2 Library page chrome", () => {
    renderTemplates({ initialTemplates: [makeTemplate()] });

    expect(screen.getByText("Build · Routines")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /library/i })).toBeInTheDocument();
    expect(screen.getByText(/reusable workflows your agents call as routines/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /browse templates/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new routine/i })).toHaveAttribute("href", "/builder");
  });

  // ---------------------------------------------------------------------------
  // Cards — secondary metadata, live pill, Open in Studio link
  // ---------------------------------------------------------------------------

  it("renders template cards with name, description, category, and metrics", () => {
    const templates = [
      makeTemplate({
        id: "t1",
        name: "Lead Enrichment",
        description: "Enrich incoming leads",
        category: "sales",
        stepCount: 5,
        configFieldCount: 4,
      }),
    ];
    renderTemplates({ initialTemplates: templates });

    expect(screen.getByText("Lead Enrichment")).toBeInTheDocument();
    expect(screen.getByText("Enrich incoming leads")).toBeInTheDocument();
    expect(screen.getByText("sales")).toBeInTheDocument();
    expect(screen.getByText("5 steps · 4 fields")).toBeInTheDocument();
  });

  it("renders a live pill on every card", () => {
    const templates = [
      makeTemplate({ id: "t1", name: "A" }),
      makeTemplate({ id: "t2", name: "B" }),
    ];
    const { container } = renderTemplates({ initialTemplates: templates });

    expect(container.querySelectorAll(".af2-pill-live").length).toBe(2);
  });

  it("links Open in Studio to the per-template builder route", () => {
    const templates = [makeTemplate({ id: "tpl-abc", name: "Routine" })];
    renderTemplates({ initialTemplates: templates });

    const link = screen.getByRole("link", { name: /open in studio/i });
    expect(link).toHaveAttribute("href", "/templates/tpl-abc");
  });

  it("shows fallback text for templates with empty description", () => {
    const templates = [makeTemplate({ description: "" })];
    renderTemplates({ initialTemplates: templates });
    expect(screen.getByText(/no description provided/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Tabs — All/Mine/Shared/Templates with count on All
  // ---------------------------------------------------------------------------

  it("renders the four library tabs with count on 'All'", () => {
    const templates = [
      makeTemplate({ id: "t1", name: "A" }),
      makeTemplate({ id: "t2", name: "B" }),
      makeTemplate({ id: "t3", name: "C" }),
    ];
    renderTemplates({ initialTemplates: templates });

    expect(screen.getByRole("button", { name: "All (3)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shared" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Templates" })).toBeInTheDocument();
  });

  it("starts with 'All' tab active and shows every template", () => {
    const templates = [
      makeTemplate({ id: "t1", name: "Ops Work", category: "ops" }),
      makeTemplate({ id: "t2", name: "Sales Work", category: "sales" }),
    ];
    renderTemplates({ initialTemplates: templates });

    expect(screen.getByRole("button", { name: /all \(2\)/i })).toHaveClass("active");
    expect(screen.getByText("Ops Work")).toBeInTheDocument();
    expect(screen.getByText("Sales Work")).toBeInTheDocument();
  });

  it("treats the 'Templates' tab as an alias for 'All'", async () => {
    const templates = [
      makeTemplate({ id: "t1", name: "Ops Work" }),
      makeTemplate({ id: "t2", name: "Sales Work" }),
    ];
    renderTemplates({ initialTemplates: templates });

    await userEvent.click(screen.getByRole("button", { name: "Templates" }));

    expect(screen.getByRole("button", { name: "Templates" })).toHaveClass("active");
    expect(screen.getByText("Ops Work")).toBeInTheDocument();
    expect(screen.getByText("Sales Work")).toBeInTheDocument();
  });

  it("shows an empty state when 'Mine' is selected (no ownership signal yet)", async () => {
    const templates = [makeTemplate({ id: "t1", name: "Ops Work" })];
    renderTemplates({ initialTemplates: templates });

    await userEvent.click(screen.getByRole("button", { name: "Mine" }));

    expect(screen.queryByText("Ops Work")).not.toBeInTheDocument();
    expect(screen.getByText(/no routines to show/i)).toBeInTheDocument();
  });

  it("shows an empty state when 'Shared' is selected (no sharing signal yet)", async () => {
    const templates = [makeTemplate({ id: "t1", name: "Ops Work" })];
    renderTemplates({ initialTemplates: templates });

    await userEvent.click(screen.getByRole("button", { name: "Shared" }));

    expect(screen.queryByText("Ops Work")).not.toBeInTheDocument();
    expect(screen.getByText(/no routines to show/i)).toBeInTheDocument();
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
