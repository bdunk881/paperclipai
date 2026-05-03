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

  it("keeps the ticketing command surface available when the ticketing API is unavailable", async () => {
    render(
      <MemoryRouter>
        <Tickets />
      </MemoryRouter>
    );

    await screen.findByText("Ticketing Command Surface");
    await screen.findByRole("button", { name: /create ticket/i });
  });
});
