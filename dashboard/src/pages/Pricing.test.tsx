import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Pricing from "./Pricing";

describe("Pricing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("renders the backend-aligned tier lineup", () => {
    render(<Pricing />);

    expect(screen.getByText("Explore")).toBeInTheDocument();
    expect(screen.getByText("Flow")).toBeInTheDocument();
    expect(screen.getByText("Automate")).toBeInTheDocument();
    expect(screen.getByText("Scale")).toBeInTheDocument();
    expect(screen.queryByText("Starter")).not.toBeInTheDocument();
    expect(screen.queryByText("Enterprise")).not.toBeInTheDocument();
  });

  it("calls the billing checkout endpoint for paid tiers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "temporary outage" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Pricing />);

    fireEvent.click(screen.getAllByRole("button", { name: /start 14-day trial/i })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/billing/checkout",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ tier: "flow" }),
        })
      );
    });
  });

  it("surfaces checkout errors instead of silently succeeding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "checkout unavailable" }),
      })
    );

    render(<Pricing />);

    fireEvent.click(screen.getAllByRole("button", { name: /start 14-day trial/i })[0]);

    await waitFor(() => {
      expect(screen.getByText(/checkout unavailable/i)).toBeInTheDocument();
    });
  });

  it("routes the free tier CTA to signup without calling checkout", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<Pricing />);

    fireEvent.click(screen.getByRole("button", { name: /start free/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/signup");
    });
  });
});
