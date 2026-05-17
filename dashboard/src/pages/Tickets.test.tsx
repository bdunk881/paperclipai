import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import Tickets from "./Tickets";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    getAccessToken: vi.fn().mockResolvedValue("token-123"),
    user: null,
  }),
}));

vi.mock("../context/useWorkspace", () => ({
  useWorkspace: () => ({ activeWorkspaceId: null }),
}));

describe("Tickets (V2 / DASH-10)", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ticketing api unavailable"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders V2 page chrome and primary CTA even when the ticketing API is unavailable", async () => {
    render(
      <MemoryRouter>
        <Tickets />
      </MemoryRouter>,
    );

    // V2 page-head: eyebrow + serif h1 + primary CTA.
    await screen.findByText(/run · assignments/i);
    await screen.findByRole("heading", { level: 1, name: /mission assignments/i });
    await screen.findByRole("button", { name: /new assignment/i });
  });
});
