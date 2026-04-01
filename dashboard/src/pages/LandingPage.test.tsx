/**
 * Component tests for the AutoFlow waitlist LandingPage.
 *
 * Covers: static content rendering, waitlist form validation,
 * submission flow (pending → success state), and feature/section presence.
 */

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import LandingPage from "./LandingPage";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
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
    expect(screen.getByText(/AI-Native Agents/i)).toBeInTheDocument();
    expect(screen.getByText(/Deploy in Minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/Full Observability/i)).toBeInTheDocument();
  });

  it("renders the How it Works section", () => {
    render(<LandingPage />);
    expect(screen.getByText(/Deploy an Agent/i)).toBeInTheDocument();
    expect(screen.getByText(/Configure Your Workflow/i)).toBeInTheDocument();
  });

  it("renders at least one email input", () => {
    render(<LandingPage />);
    const inputs = screen.getAllByPlaceholderText(/email/i);
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
      vi.runAllTimers();
    });

    // Success state should NOT appear
    expect(screen.queryByText(/you're on the list/i)).toBeNull();
  });

  it("does not submit when email is only whitespace", async () => {
    render(<LandingPage />);
    const emailInput = screen.getAllByPlaceholderText(/email/i)[0];
    const submitBtn = screen.getAllByRole("button", { name: /join the waitlist/i })[0];

    await act(async () => {
      fireEvent.change(emailInput, { target: { value: "   " } });
      fireEvent.click(submitBtn);
      vi.runAllTimers();
    });

    expect(screen.queryByText(/you're on the list/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Waitlist form — submission flow
// ---------------------------------------------------------------------------

describe("LandingPage — submission flow", () => {
  it("shows 'Joining...' while the simulated API call is pending", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<LandingPage />);

    const emailInput = screen.getAllByPlaceholderText(/email/i)[0];
    await user.type(emailInput, "test@example.com");

    // Start submit but don't advance timers yet
    const submitBtn = screen.getAllByRole("button", { name: /join the waitlist/i })[0];
    await user.click(submitBtn);

    // Should show loading state immediately
    expect(screen.getAllByText(/Joining\.\.\./i).length).toBeGreaterThan(0);
  });

  it("transitions to success state after simulated API call (800ms)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<LandingPage />);

    const emailInput = screen.getAllByPlaceholderText(/email/i)[0];
    await user.type(emailInput, "waitlist@example.com");

    const submitBtn = screen.getAllByRole("button", { name: /join the waitlist/i })[0];
    await user.click(submitBtn);

    // Advance past the 800ms simulated API delay
    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/you're on the list/i)).toBeInTheDocument();
    });
  });

  it("success state is shown after submission — no longer shows the form submit button", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(<LandingPage />);

    const emailInput = screen.getAllByPlaceholderText(/email/i)[0];
    await user.type(emailInput, "early@adopter.com");

    const submitBtn = screen.getAllByRole("button", { name: /join the waitlist/i })[0];
    await user.click(submitBtn);

    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/you're on the list/i)).toBeInTheDocument();
    });

    // Original submit button should no longer be visible
    const remainingBtns = screen.queryAllByRole("button", { name: /join the waitlist/i });
    expect(remainingBtns.length).toBe(0);
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
