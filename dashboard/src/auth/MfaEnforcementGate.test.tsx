import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MfaEnforcementGate } from "./MfaEnforcementGate";

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
        <Route path="/onboarding/mfa" element={<div>enrollment-wizard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MfaEnforcementGate", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockResolvedValue("access-token");
    window.localStorage.removeItem("autoflow.mfa.enforcement");
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem("autoflow.mfa.enforcement");
  });

  it("renders children once the policy returns hasAnyFactor=true", async () => {
    getMfaPolicyMock.mockResolvedValue({
      hasAnyFactor: true,
      hasWebauthn: true,
      hasTotp: false,
      hasRecoveryCodes: true,
      webauthnDevices: [],
      enrollmentCompletedAt: null,
      lastVerifiedAt: null,
      lastVerifiedMethod: null,
      recoveryCodesIssuedAt: null,
    });
    renderGate();
    await waitFor(() => expect(screen.getByText("protected-content")).toBeInTheDocument());
  });

  it("redirects to /onboarding/mfa when the user has no factors", async () => {
    getMfaPolicyMock.mockResolvedValue({
      hasAnyFactor: false,
      hasWebauthn: false,
      hasTotp: false,
      hasRecoveryCodes: false,
      webauthnDevices: [],
      enrollmentCompletedAt: null,
      lastVerifiedAt: null,
      lastVerifiedMethod: null,
      recoveryCodesIssuedAt: null,
    });
    renderGate();
    await waitFor(() => expect(screen.getByText("enrollment-wizard")).toBeInTheDocument());
    expect(screen.queryByText("protected-content")).not.toBeInTheDocument();
  });

  it("fails open and renders children if the policy fetch errors out", async () => {
    getMfaPolicyMock.mockRejectedValue(new Error("network down"));
    renderGate();
    await waitFor(() => expect(screen.getByText("protected-content")).toBeInTheDocument());
  });

  it("respects the localStorage dev bypass", async () => {
    window.localStorage.setItem("autoflow.mfa.enforcement", "off");
    // even if policy says no factors, bypass should pass through
    getMfaPolicyMock.mockResolvedValue({
      hasAnyFactor: false,
      hasWebauthn: false,
      hasTotp: false,
      hasRecoveryCodes: false,
      webauthnDevices: [],
      enrollmentCompletedAt: null,
      lastVerifiedAt: null,
      lastVerifiedMethod: null,
      recoveryCodesIssuedAt: null,
    });
    renderGate();
    await waitFor(() => expect(screen.getByText("protected-content")).toBeInTheDocument());
  });

  it("does not gate the onboarding route itself (no redirect loop)", async () => {
    getMfaPolicyMock.mockResolvedValue({
      hasAnyFactor: false,
      hasWebauthn: false,
      hasTotp: false,
      hasRecoveryCodes: false,
      webauthnDevices: [],
      enrollmentCompletedAt: null,
      lastVerifiedAt: null,
      lastVerifiedMethod: null,
      recoveryCodesIssuedAt: null,
    });
    render(
      <MemoryRouter initialEntries={["/onboarding/mfa"]}>
        <Routes>
          <Route
            path="/onboarding/mfa"
            element={
              <MfaEnforcementGate>
                <div>wizard-inside-gate</div>
              </MfaEnforcementGate>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("wizard-inside-gate")).toBeInTheDocument());
  });
});
