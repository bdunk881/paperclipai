import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import WorkflowBuilder from "./WorkflowBuilder";

vi.mock("../api/client", () => ({
  listTemplates: vi.fn().mockResolvedValue([]),
  getTemplate: vi.fn(),
  listLLMConfigs: vi.fn().mockResolvedValue([]),
  startRun: vi.fn(),
  startRunWithFile: vi.fn(),
  generateWorkflow: vi.fn(),
  createTemplate: vi.fn(),
}));

describe("WorkflowBuilder", () => {
  it("opens and closes the guidance panel", async () => {
    render(
      <MemoryRouter initialEntries={["/builder"]}>
        <Routes>
          <Route path="/builder" element={<WorkflowBuilder />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Start building your workflow")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /guidance/i }));
    expect(screen.getByText("Build and launch confidently")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Build and launch confidently")).toBeNull();
  });
});
