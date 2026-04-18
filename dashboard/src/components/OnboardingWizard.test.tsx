import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import OnboardingWizard, { type OnboardingStep } from "./OnboardingWizard";

const STEPS: OnboardingStep[] = [
  {
    id: "connect",
    title: "Connect provider",
    detail: "Connect your first model",
    to: "/settings/llm-providers",
    cta: "Connect",
    done: false,
  },
];

describe("OnboardingWizard", () => {
  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <OnboardingWizard open onClose={onClose} steps={STEPS} />
      </MemoryRouter>
    );

    expect(screen.getByRole("dialog", { name: /first-run onboarding/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
