import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentOAuthCallback from "./AgentOAuthCallback";

describe("AgentOAuthCallback", () => {
  const originalOpener = window.opener;
  const originalClose = window.close;

  beforeEach(() => {
    Object.defineProperty(window, "opener", {
      configurable: true,
      value: { postMessage: vi.fn() },
    });
    Object.defineProperty(window, "close", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "opener", { configurable: true, value: originalOpener });
    Object.defineProperty(window, "close", { configurable: true, value: originalClose });
  });

  it("posts a success payload back to the opener and closes the window", async () => {
    render(
      <MemoryRouter initialEntries={["/agent/oauth/callback?provider=slack&status=success"]}>
        <Routes>
          <Route path="/agent/oauth/callback" element={<AgentOAuthCallback />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/connection complete/i)).toBeInTheDocument();
    expect(screen.getByText(/Finishing slack verification/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(window.opener?.postMessage).toHaveBeenCalledWith(
        {
          type: "autoflow:agent-catalog-oauth-callback",
          provider: "slack",
          status: "success",
          message: "",
        },
        window.location.origin
      );
      expect(window.close).toHaveBeenCalledTimes(1);
    });
  });

  it("renders the failure state when the callback reports an error", () => {
    render(
      <MemoryRouter initialEntries={["/agent/oauth/callback?provider=hubspot&status=error&message=OAuth%20failed"]}>
        <Routes>
          <Route path="/agent/oauth/callback" element={<AgentOAuthCallback />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/connection failed/i)).toBeInTheDocument();
    expect(screen.getByText("OAuth failed")).toBeInTheDocument();
  });
});
