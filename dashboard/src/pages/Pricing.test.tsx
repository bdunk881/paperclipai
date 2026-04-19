import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Pricing from "./Pricing";

describe("Pricing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls the billing checkout endpoint for paid tiers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "temporary outage" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Pricing />);

    fireEvent.click(screen.getByRole("button", { name: /get started/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/billing/checkout",
        expect.objectContaining({
          method: "POST",
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

    fireEvent.click(screen.getByRole("button", { name: /get started/i }));

    await waitFor(() => {
      expect(screen.getByText(/checkout unavailable/i)).toBeInTheDocument();
    });
  });
});
