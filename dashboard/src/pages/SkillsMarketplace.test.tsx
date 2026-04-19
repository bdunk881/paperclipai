import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SkillsMarketplaceBrowse from "./SkillsMarketplaceBrowse";
import InstalledSkills from "./InstalledSkills";
import { SkillsMarketplaceProvider } from "../context/SkillsMarketplaceContext";

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <SkillsMarketplaceProvider>{ui}</SkillsMarketplaceProvider>
    </MemoryRouter>
  );
}

describe("Skills Marketplace Browse", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("renders the marketplace heading and initial content", () => {
    renderWithProvider(<SkillsMarketplaceBrowse />);

    expect(screen.getByRole("heading", { name: /Skills Marketplace/i })).toBeInTheDocument();
    expect(screen.getByText(/Ops Reporter/i)).toBeInTheDocument();
    expect(screen.getByText(/Content Sprint/i)).toBeInTheDocument();
  });

  it("filters by search query", () => {
    renderWithProvider(<SkillsMarketplaceBrowse />);

    fireEvent.change(screen.getByPlaceholderText(/Search skills/i), {
      target: { value: "incident" },
    });

    expect(screen.getByText(/Incident Briefer/i)).toBeInTheDocument();
    expect(screen.queryByText(/Ops Reporter/i)).toBeNull();
  });

  it("installs a skill through confirm modal", async () => {
    vi.useRealTimers();
    renderWithProvider(<SkillsMarketplaceBrowse />);

    const installButtons = screen.getAllByRole("button", { name: "Install" });
    fireEvent.click(installButtons[0]);

    expect(screen.getByRole("heading", { name: /Install skill/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Confirm install/i }));

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Installed" }).length).toBeGreaterThanOrEqual(3);
    }, { timeout: 4000 });
  });
});

describe("Installed Skills", () => {
  it("renders installed skills and allows enable/disable toggling", () => {
    renderWithProvider(<InstalledSkills />);

    expect(screen.getByText(/Ops Reporter/i)).toBeInTheDocument();
    expect(screen.getByText(/Workspace Automator/i)).toBeInTheDocument();

    const disableButtons = screen.getAllByRole("button", { name: /Disable/i });
    fireEvent.click(disableButtons[0]);

    expect(screen.queryAllByRole("button", { name: /Disable/i }).length).toBe(0);
    expect(screen.getAllByRole("button", { name: /Enable/i }).length).toBeGreaterThanOrEqual(2);
  });
});
