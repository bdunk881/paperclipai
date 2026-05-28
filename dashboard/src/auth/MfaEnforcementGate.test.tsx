import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MfaEnforcementGate } from "./MfaEnforcementGate";
import {
  ENROLLMENT_COMPLETED_EVENT,
  ENROLLMENT_REQUIRED_EVENT,
} from "./enrollmentEvents";

const { getMfaPolicyMock, requireAccessTokenMock } = vi.hoisted(() => ({
  getMfaPolicyMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
}));

vi.mock("../api/mfaApi", () => ({
  getMfaPolicy: getMfaPolicyMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-1", email: "alice@example.com", name: "Alice" },
    requireAccessToken: requireAccessTokenMock,
  }),
}));

interface PolicyOverrides {
  hasAnyFactor?: boolean;
  signInMethod?: string;
  requiresAppMfa?: boolean;
}

function buildPolicy(overrides: PolicyOverrides = {}) {
  return {
    hasAnyFactor: false,
    hasWebauthn: false,
    hasTotp: false,
    hasRecoveryCodes: false,
    signInMethod: "password",
    requiresAppMfa: true,
    webauthnDevices: [],
    enrollmentCompletedAt: null,
    lastVerifiedAt: null,
    lastVerifiedMethod: null,
    recoveryCodesIssuedAt: null,
    ...overrides,
  };
}

function renderGate(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/"
          element={
            <MfaEnforcementGate>
              <div>protected-content</div>
            </MfaEnforcementGate>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MfaEnforcementGate", () => {
  let enrollmentRequiredSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    requireAccessTokenMock.mockResolvedValue("access-token");
    window.localStorage.removeItem("autoflow.mfa.enforcement");
    enrollmentRequiredSpy = vi.fn();
    window.addEventListener(ENROLLMENT_REQUIRED_EVENT, enrollmentRequiredSpy);
  });

  afterEach(() => {
    window.removeEventListener(ENROLLMENT_REQUIRED_EVENT, enrollmentRequiredSpy);
    vi.clearAllMocks();
    window.localStorage.removeItem("autoflow.mfa.enforcement");
  });

  it("renders children once the policy returns hasAnyFactor=true", async () => {
    getMfaPolicyMock.mockResolvedValue(buildPolicy({ hasAnyFactor: true }));
    renderGate();
    await waitFor(() => expect(screen.getByText("protected-content")).toBeInTheDocument());
    expect(enrollmentRequiredSpy).not.toHaveBeenCalled();
  });

  // HEL-281: redirect was replaced by an event + the children stay rendered.
  // The dashboard shows behind the global <MfaEnrollmentSheet> scrim.
  it("emits enrollment-required AND renders children when policy says no factors", async () => {
    getMfaPolicyMock.mockResolvedValue(buildPolicy());
    renderGate();
    await waitFor(() => expect(enrollmentRequiredSpy).toHaveBeenCalledTimes(1));
    expect(screen.getByText("protected-content")).toBeInTheDocument();
    const event = enrollmentRequiredSpy.mock.calls[0][0] as CustomEvent<{ from?: string }>;
    expect(event.detail.from).toBe("/");
  });

  it("fails open and renders children if the policy fetch errors out", async () => {
    getMfaPolicyMock.mockRejectedValue(new Error("network down"));
    renderGate();
    await waitFor(() => expect(screen.getByText("protected-content")).toBeInTheDocument());
    expect(enrollmentRequiredSpy).not.toHaveBeenCalled();
  });

  it("respects the localStorage dev bypass", async () => {
    window.localStorage.setItem("autoflow.mfa.enforcement", "off");
    getMfaPolicyMock.mockResolvedValue(buildPolicy());
    renderGate();
    await waitFor(() => expect(screen.getByText("protected-content")).toBeInTheDocument());
    expect(enrollmentRequiredSpy).not.toHaveBeenCalled();
  });

  // HEL-280 ----------------------------------------------------------------

  it("renders children when an OAuth user has no factors but requiresAppMfa=false", async () => {
    getMfaPolicyMock.mockResolvedValue(
      buildPolicy({ signInMethod: "oauth_google", requiresAppMfa: false }),
    );
    renderGate();
    await waitFor(() => expect(screen.getByText("protected-content")).toBeInTheDocument());
    expect(enrollmentRequiredSpy).not.toHaveBeenCalled();
  });

  it("emits for an OAuth user when requiresAppMfa=true (enterprise override)", async () => {
    getMfaPolicyMock.mockResolvedValue(
      buildPolicy({ signInMethod: "oauth_google", requiresAppMfa: true }),
    );
    renderGate();
    await waitFor(() => expect(enrollmentRequiredSpy).toHaveBeenCalledTimes(1));
    expect(screen.getByText("protected-content")).toBeInTheDocument();
  });

  // HEL-281 ----------------------------------------------------------------

  it("re-fetches policy on ENROLLMENT_COMPLETED_EVENT so the gate unblocks", async () => {
    // First fetch: no factor. Subsequent fetch (after the event): factor exists.
    getMfaPolicyMock
      .mockResolvedValueOnce(buildPolicy())
      .mockResolvedValueOnce(buildPolicy({ hasAnyFactor: true }));

    renderGate();
    await waitFor(() => expect(enrollmentRequiredSpy).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event(ENROLLMENT_COMPLETED_EVENT));

    await waitFor(() => expect(getMfaPolicyMock).toHaveBeenCalledTimes(2));
    // No second emit — the new policy has a factor.
    expect(enrollmentRequiredSpy).toHaveBeenCalledTimes(1);
  });
});
