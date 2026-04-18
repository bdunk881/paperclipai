import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AgentDeploy from "./AgentDeploy";

describe("AgentDeploy", () => {
  it("shows deploy progress after submit", () => {
    render(
      <MemoryRouter initialEntries={["/agents/deploy/sales-prospecting"]}>
        <Routes>
          <Route path="/agents/deploy/:templateId" element={<AgentDeploy />} />
          <Route path="/agents/my" element={<div>My agents page</div>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: /deploy agent/i }));

    expect(screen.getByText(/deploying agent/i)).toBeInTheDocument();
    expect(screen.getByText(/deploying\.\.\./i)).toBeInTheDocument();
  });
});
