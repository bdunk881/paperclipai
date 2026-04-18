/**
 * Component tests for the AutoFlow waitlist LandingPage.
 *
 * Covers: static content rendering, waitlist form validation,
 * submission flow (pending → success state), and feature/section presence.
 */

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import LandingPage from "./LandingPage";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Static content
// ---------------------------------------------------------------------------

describe("LandingPage — static content", () => {
  it("renders the AutoFlow brand name", () => {
    render(<LandingPage />);
    expect(screen.getAllByText(/autoflow/i).length).toBeGreaterThan(0);
  });

  it("renders the hero headline", () => {
    render(<LandingPage />);
    expect(screen.getByText(/AI Automation Platform/i)).toBeInTheDocument();
  });

  it("renders at least one 'Join the waitlist' CTA", () => {
    render(<LandingPage />);
    const ctas = screen.getAllByText(/join the waitlist/i);
    expect(ctas.length).toBeGreaterThan(0);
  });

  it("renders the Features section", () => {
    render(<LandingPage />);
    // All feature titles should be present
    expect(screen.getAllByText(/AI-Native Agents/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Deploy in Minutes/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Full Observability/i).length).toBeGreaterThan(0);
  });

  it("renders the How it Works section", () => {
    render(<LandingPage />);
    expect(screen.getByText(/Deploy an Agent/i)).toBeInTheDocument();
    expect(screen.getByText(/Configure Your Workflow/i)).toBeInTheDocument();
  });

  it("renders at least one email input", () => {
    render(<LandingPage />);
    // eslint-disable-next-line testing-library/no-container
    const inputs = document.querySelectorAll('input[type="email"]');
    expect(inputs.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Waitlist form — validation
// ---------------------------------------------------------------------------

describe("LandingPage — form validation", () => {
  it("does not submit when email is empty", async () => {
    render(<LandingPage />);
    const submitBtn = screen.getAllByRole("button", { name: /join the waitlist/i })[0];

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Success state should NOT appear — early return before fetch
    expect(screen.queryByText(/you're on the list/i)).toBeNull();
  });

  it("does not submit when email is only whitespace", async () => {
    render(<LandingPage />);
    const emailInput = screen.getAllByPlaceholderText(/you@company\.com/i)[0];
    const submitBtn = screen.getAllByRole("button", { name: /join the waitlist/i })[0];

    await act(async () => {
      fireEvent.change(emailInput, { target: { value: "   " } });
      fireEvent.click(submitBtn);
    });

    expect(screen.queryByText(/you're on the list/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Waitlist form — submission flow
// ---------------------------------------------------------------------------

describe("LandingPage — submission flow", () => {
  it("shows 'Joining...' while the API call is pending", async () => {
    // Mock fetch to never resolve so we can observe the in-flight state
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<LandingPage />);

    const emailInput = screen.getAllByPlaceholderText(/you@company\.com/i)[0];
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /join the waitlist/i })[0]);
    });

    expect(screen.getAllByText(/Joining\.\.\./i).length).toBeGreaterThan(0);
  });

  it("transitions to success state after API call completes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true } as Response)
    );
    render(<LandingPage />);

    const emailInput = screen.getAllByPlaceholderText(/you@company\.com/i)[0];
    fireEvent.change(emailInput, { target: { value: "waitlist@example.com" } });
    fireEvent.click(screen.getAllByRole("button", { name: /join the waitlist/i })[0]);

    await waitFor(() => {
      expect(screen.getAllByText(/you're on the list/i).length).toBeGreaterThan(0);
    });
  });

  it("success state is shown after submission — no longer shows the form submit button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true } as Response)
    );
    render(<LandingPage />);

    const emailInput = screen.getAllByPlaceholderText(/you@company\.com/i)[0];
    fireEvent.change(emailInput, { target: { value: "early@adopter.com" } });
    fireEvent.click(screen.getAllByRole("button", { name: /join the waitlist/i })[0]);

    await waitFor(() => {
      expect(screen.getAllByText(/you're on the list/i).length).toBeGreaterThan(0);
    });

    expect(screen.queryAllByRole("button", { name: /join the waitlist/i }).length).toBe(0);
  });

  it("shows an error and does not show success state when the API call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response)
    );
    render(<LandingPage />);

    const emailInput = screen.getAllByPlaceholderText(/you@company\.com/i)[0];
    fireEvent.change(emailInput, { target: { value: "waitlist@example.com" } });
    fireEvent.click(screen.getAllByRole("button", { name: /join the waitlist/i })[0]);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/signup failed/i);
    });

    expect(screen.queryByText(/you're on the list/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("LandingPage — navigation", () => {
  it("renders a link/button that scrolls to the waitlist section", () => {
    render(<LandingPage />);
    // The nav CTA links to #waitlist
    const waitlistLink = screen.getAllByRole("link").find(
      (el) => el.getAttribute("href") === "#waitlist"
    );
    expect(waitlistLink).toBeDefined();
  });
});
