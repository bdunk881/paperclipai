/**
 * Routines hub tests (HEL-208 / PR E).
 *
 * Replaces the former Templates page tests with the two-tab Routines hub
 * shape — Mine (table) + Library (cards with expanded detail).
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateSummary } from "../api/client";

const {
  listTemplatesMock,
  getConnectorHealthMock,
  listRunsMock,
  createTemplateMock,
  getAccessTokenMock,
} = vi.hoisted(() => ({
  listTemplatesMock: vi.fn(),
  getConnectorHealthMock: vi.fn().mockResolvedValue({ connectors: [] }),
  listRunsMock: vi.fn().mockResolvedValue([]),
  createTemplateMock: vi.fn(),
  getAccessTokenMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("../api/client", () => ({
  listTemplates: listTemplatesMock,
  getConnectorHealth: getConnectorHealthMock,
  listRuns: listRunsMock,
  createTemplate: createTemplateMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "Test User" },
    getAccessToken: getAccessTokenMock,
  }),
}));

import Routines from "./Routines";

function makeTemplate(
  overrides: Partial<TemplateSummary> = {}
): TemplateSummary {
  return {
    id: "tpl-1",
    name: "My Template",
    description: "A description",
    category: "operations",
    version: "1.0",
    stepCount: 3,
    configFieldCount: 2,
    ...overrides,
  };
}

function renderRoutines(
  props: { initialTemplates?: TemplateSummary[] } = {}
) {
  return render(
    <MemoryRouter>
      <Routines {...props} />
    </MemoryRouter>
  );
}

describe("Routines page (HEL-208)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectorHealthMock.mockResolvedValue({ connectors: [] });
    listRunsMock.mockResolvedValue([]);
    getAccessTokenMock.mockResolvedValue(null);
  });

  // ---------------------------------------------------------------------------
  // initialTemplates prop path (no API call)
  // ---------------------------------------------------------------------------

  it("renders rows from initialTemplates without calling listTemplates", () => {
    const templates = [makeTemplate({ id: "t1", name: "Alpha Workflow" })];
    renderRoutines({ initialTemplates: templates });

    expect(screen.getByText("Alpha Workflow")).toBeInTheDocument();
    expect(listTemplatesMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Loading / error paths
  // ---------------------------------------------------------------------------

  it("shows loading state while fetching", () => {
    listTemplatesMock.mockReturnValue(new Promise(() => {}));
    renderRoutines();
    expect(screen.getByText(/loading routines/i)).toBeInTheDocument();
  });

  it("shows error state when fetch rejects", async () => {
    listTemplatesMock.mockRejectedValueOnce(new Error("network error"));
    renderRoutines();
    await waitFor(() =>
      expect(screen.getByText(/routines unavailable/i)).toBeInTheDocument()
    );
    expect(screen.getByText("network error")).toBeInTheDocument();
  });

  it("renders fetched templates after successful load", async () => {
    listTemplatesMock.mockResolvedValueOnce([
      makeTemplate({ name: "Remote Template" }),
    ]);
    renderRoutines();
    await waitFor(() =>
      expect(screen.getByText("Remote Template")).toBeInTheDocument()
    );
  });

  // ---------------------------------------------------------------------------
  // v2 chrome
  // ---------------------------------------------------------------------------

  it("renders the Routines page chrome (eyebrow, h1, blank-routine link)", () => {
    renderRoutines({ initialTemplates: [makeTemplate()] });

    expect(screen.getByText("Build · Routines")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /^routines$/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/reusable workflows your agents call as routines/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /blank routine/i })
    ).toHaveAttribute("href", "/builder");
  });

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  it("renders Mine and Library tabs with counts", () => {
    const templates = [
      makeTemplate({ id: "t1", name: "A" }),
      makeTemplate({ id: "t2", name: "B" }),
    ];
    renderRoutines({ initialTemplates: templates });

    expect(
      screen.getByRole("button", { name: /^mine \(2\)$/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^library \(2\)$/i })
    ).toBeInTheDocument();
  });

  it("starts on the Mine tab", () => {
    renderRoutines({ initialTemplates: [makeTemplate({ name: "Ops" })] });
    expect(screen.getByRole("button", { name: /^mine/i })).toHaveClass(
      "active"
    );
  });

  // ---------------------------------------------------------------------------
  // Mine tab — rows + Launch in Studio CTA
  // ---------------------------------------------------------------------------

  it("renders Mine rows with Launch in Studio link to the builder", () => {
    const templates = [makeTemplate({ id: "tpl-abc", name: "Routine A" })];
    renderRoutines({ initialTemplates: templates });

    expect(screen.getByText("Routine A")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /launch in studio/i });
    expect(link).toHaveAttribute("href", "/builder/tpl-abc");
  });

  it("opens an inline drawer when a Mine row is clicked", async () => {
    const templates = [makeTemplate({ id: "tpl-1", name: "Drawer Row" })];
    renderRoutines({ initialTemplates: templates });

    await userEvent.click(screen.getByText("Drawer Row"));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText(/last 5 runs/i)).toBeInTheDocument();
    expect(screen.getByText(/recent edits/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Library tab — card + expanded detail + chips
  // ---------------------------------------------------------------------------

  it("switches to Library and renders a card per template", async () => {
    const templates = [
      makeTemplate({ id: "t1", name: "Lead Enrichment", category: "sales" }),
    ];
    renderRoutines({ initialTemplates: templates });

    await userEvent.click(screen.getByRole("button", { name: /^library/i }));

    expect(screen.getByText("Lead Enrichment")).toBeInTheDocument();
    expect(screen.getByText("sales")).toBeInTheDocument();
  });

  it("expands a library card on click and shows Use template button", async () => {
    const templates = [
      makeTemplate({ id: "t1", name: "Expand Me", category: "sales" }),
    ];
    renderRoutines({ initialTemplates: templates });

    await userEvent.click(screen.getByRole("button", { name: /^library/i }));
    await userEvent.click(screen.getByText("Expand Me"));

    expect(
      screen.getByRole("button", { name: /use template/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/suggested integrations/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // v2 structural marker regression guard
  // ---------------------------------------------------------------------------

  it("renders v2 structural markers", () => {
    const { container } = renderRoutines({
      initialTemplates: [makeTemplate({ name: "Marker Template" })],
    });

    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector(".af2-eyebrow")).not.toBeNull();
    expect(container.querySelector("h1.af2-h1")).not.toBeNull();
    expect(container.querySelector(".af2-tabs")).not.toBeNull();
    expect(container.querySelectorAll(".af2-card").length).toBeGreaterThan(0);
  });
});
