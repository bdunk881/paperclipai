/**
 * OnboardingBanner — first-run activation guide (HEL-554).
 *
 * Covers the zero-setup framing added in HEL-554: step 1 reassures the user
 * that hosted models need no API key (the #1 first-run drop-off), and the
 * CTAs route to the actual next actions (brief a mission / connect a tool).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { OnboardingBanner, ONBOARDING_DISMISS_KEY } from "./OnboardingBanner";

function renderBanner(props: { show: boolean; firstName?: string }) {
  return render(
    <MemoryRouter>
      <OnboardingBanner show={props.show} firstName={props.firstName ?? ""} />
    </MemoryRouter>,
  );
}

describe("OnboardingBanner (HEL-554)", () => {
  beforeEach(() => {
    window.localStorage.removeItem(ONBOARDING_DISMISS_KEY);
  });
  afterEach(() => {
    window.localStorage.removeItem(ONBOARDING_DISMISS_KEY);
  });

  it("renders nothing when show is false", () => {
    const { container } = renderBanner({ show: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("reassures that hosted models need no key, and shows the three steps", () => {
    renderBanner({ show: true, firstName: "Bri" });
    expect(screen.getByText(/Welcome, Bri/i)).toBeInTheDocument();
    // The HEL-554 fix: the very first step kills the "I need an API key" cliff.
    expect(screen.getByText(/no API key needed/i)).toBeInTheDocument();
    expect(screen.getByText(/Pick how your agents think/i)).toBeInTheDocument();
    expect(screen.getByText(/Brief a mission/i)).toBeInTheDocument();
    expect(screen.getByText(/Confirm & watch/i)).toBeInTheDocument();
  });

  it("routes the primary CTA to /hire and the secondary to /connections", () => {
    renderBanner({ show: true });
    expect(
      screen.getByRole("link", { name: /Brief your first mission/i }),
    ).toHaveAttribute("href", "/hire");
    expect(
      screen.getByRole("link", { name: /Connect a tool/i }),
    ).toHaveAttribute("href", "/connections");
  });

  it("can be dismissed and persists the dismissal", () => {
    const { container } = renderBanner({ show: true });
    fireEvent.click(
      screen.getByRole("button", { name: /Dismiss onboarding guide/i }),
    );
    expect(container).toBeEmptyDOMElement();
    expect(window.localStorage.getItem(ONBOARDING_DISMISS_KEY)).toBe("1");
  });
});
