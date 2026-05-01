import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import Tickets from "./Tickets";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    getAccessToken: vi.fn().mockResolvedValue("token-123"),
  }),
}));

describe("Tickets", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ticketing api unavailable"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the built-in fallback queue when the ticketing API is unavailable", async () => {
    render(
      <MemoryRouter>
        <Tickets />
      </MemoryRouter>
    );

    await screen.findByText("Ship ticketing foundation for launch review");
    await screen.findByText(
      /showing local ticketing fallback data while the backend branch is still in review/i
    );
  });
});
