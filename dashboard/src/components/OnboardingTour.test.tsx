import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OnboardingTour } from "./OnboardingTour";

const DISMISS_KEY = "af2-onboarding-tour-dismissed-v1";

describe("OnboardingTour (DASH-17)", () => {
  beforeEach(() => {
    window.localStorage.removeItem(DISMISS_KEY);
    // Seed the DOM with the sidebar anchors the tour expects.
    document.body.innerHTML = `
      <nav>
        <a href="/hire">Hire</a>
        <a href="/mission-assignments">Assignments</a>
        <a href="/integrations/mcp">Integrations</a>
        <a href="/settings/llm-providers">Models</a>
      </nav>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.localStorage.removeItem(DISMISS_KEY);
  });

  it("renders the first tour step after mount (deferred so the sidebar is in the DOM)", async () => {
    render(<OnboardingTour />);
    expect(
      await screen.findByText(/welcome · step 1 of 4/i, undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /start here: write your mission/i }),
    ).toBeInTheDocument();
  });

  it("advances on Next and finishes on the last step", async () => {
    const user = userEvent.setup();
    render(<OnboardingTour />);

    await screen.findByText(/welcome · step 1 of 4/i, undefined, { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/welcome · step 2 of 4/i);
    await user.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/welcome · step 3 of 4/i);
    await user.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/welcome · step 4 of 4/i);

    // Final step shows "Got it" instead of "Next".
    const finalCta = screen.getByRole("button", { name: /got it/i });
    await user.click(finalCta);

    // Tour vanishes and the dismiss flag is set.
    await waitFor(() =>
      expect(screen.queryByText(/welcome · step/i)).not.toBeInTheDocument(),
    );
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("doesn't reappear after dismissal", async () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    render(<OnboardingTour />);
    // Give the deferred-mount timeout a chance to fire — it should bail.
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByText(/welcome · step/i)).not.toBeInTheDocument();
  });
});
