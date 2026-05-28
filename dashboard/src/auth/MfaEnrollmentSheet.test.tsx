import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MfaEnrollmentSheet } from "./MfaEnrollmentSheet";
import {
  ENROLLMENT_COMPLETED_EVENT,
  ENROLLMENT_REQUIRED_EVENT,
  emitEnrollmentRequired,
} from "./enrollmentEvents";

// MfaEnrollmentFlow has its own integration tests via the wizard route.
// Here we stub it so the sheet's open/close + dismissal behavior is the
// only thing under test.
vi.mock("./MfaEnrollmentFlow", () => ({
  MfaEnrollmentFlow: ({ onComplete }: { onComplete: () => void }) => (
    <button type="button" onClick={onComplete} data-testid="flow-complete">
      complete-stub
    </button>
  ),
}));

describe("MfaEnrollmentSheet (HEL-281)", () => {
  beforeEach(() => {
    // Default to desktop layout. Sheet checks matchMedia at mount.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders nothing until the enrollment-required event fires", () => {
    const { container } = render(<MfaEnrollmentSheet />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens on ENROLLMENT_REQUIRED_EVENT and shows the title", () => {
    render(<MfaEnrollmentSheet />);
    act(() => {
      emitEnrollmentRequired({ from: "/" });
    });
    expect(screen.getByText(/set up two-factor auth/i)).toBeInTheDocument();
  });

  it("does NOT close on Escape (enrollment is mandatory)", () => {
    render(<MfaEnrollmentSheet />);
    act(() => {
      emitEnrollmentRequired({ from: "/" });
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText(/set up two-factor auth/i)).toBeInTheDocument();
  });

  it("closes and emits ENROLLMENT_COMPLETED_EVENT after the flow completes", () => {
    const completedSpy = vi.fn();
    window.addEventListener(ENROLLMENT_COMPLETED_EVENT, completedSpy);
    render(<MfaEnrollmentSheet />);
    act(() => {
      emitEnrollmentRequired({ from: "/" });
    });
    fireEvent.click(screen.getByTestId("flow-complete"));
    expect(completedSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/set up two-factor auth/i)).not.toBeInTheDocument();
    window.removeEventListener(ENROLLMENT_COMPLETED_EVENT, completedSpy);
  });

  it("does NOT auto-fire on its own event-name spelling drift", () => {
    // Guard against a future refactor renaming the event but missing
    // the listener — ensure the constant matches.
    expect(ENROLLMENT_REQUIRED_EVENT).toBe("autoflow:mfa:enrollment-required");
    expect(ENROLLMENT_COMPLETED_EVENT).toBe("autoflow:mfa:enrollment-completed");
  });
});
