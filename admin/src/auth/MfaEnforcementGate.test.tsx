// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { MfaEnforcementGate } from "./MfaEnforcementGate";

const { getMfaPolicyMock } = vi.hoisted(() => ({
  getMfaPolicyMock: vi.fn(),
}));

vi.mock("../api/mfaApi", () => ({
  getMfaPolicy: getMfaPolicyMock,
}));

function buildPolicy(overrides: { hasAnyFactor?: boolean } = {}) {
  return {
    hasWebauthn: false,
    hasTotp: false,
    hasEmailOtp: false,
    hasMagicLink: false,
    hasAnyFactor: false,
    hasRecoveryCodes: false,
    enrollmentCompletedAt: null,
    lastVerifiedAt: null,
    lastVerifiedMethod: null,
    recoveryCodesIssuedAt: null,
    webauthnDevices: [],
    ...overrides,
  };
}

// Sentinel for the enrollment route so a redirect is observable, and so we
// can assert the `state.from` the gate forwards for the bounce-back.
function OnboardingSentinel() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "(none)";
  return <div>{`enroll-wizard:${from}`}</div>;
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
        <Route path="/onboarding/mfa" element={<OnboardingSentinel />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MfaEnforcementGate (admin, HEL-391)", () => {
  beforeEach(() => {
    window.localStorage.removeItem("autoflow.mfa.enforcement");
  });

  afterEach(() => {
    // The admin app has no vitest `globals`/setup, so @testing-library/react's
    // automatic per-test cleanup isn't registered — clean up explicitly or
    // renders accumulate across tests in this file.
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    window.localStorage.removeItem("autoflow.mfa.enforcement");
  });

  it("renders children once the policy returns hasAnyFactor=true", async () => {
    getMfaPolicyMock.mockResolvedValue(buildPolicy({ hasAnyFactor: true }));
    renderGate();
    await waitFor(() => expect(screen.getByText("protected-content")).toBeInTheDocument());
    expect(screen.queryByText(/enroll-wizard/)).not.toBeInTheDocument();
  });

  it("redirects unenrolled staff to /onboarding/mfa (carrying state.from)", async () => {
    getMfaPolicyMock.mockResolvedValue(buildPolicy({ hasAnyFactor: false }));
    renderGate("/");
    await waitFor(() => expect(screen.getByText("enroll-wizard:/")).toBeInTheDocument());
    expect(screen.queryByText("protected-content")).not.toBeInTheDocument();
  });

  it("fails CLOSED on a policy-fetch error (blocks with a retry, no children)", async () => {
    getMfaPolicyMock.mockRejectedValue(new Error("network down"));
    renderGate();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/can.t verify mfa/i)).toBeInTheDocument();
    expect(screen.queryByText("protected-content")).not.toBeInTheDocument();
    expect(screen.queryByText(/enroll-wizard/)).not.toBeInTheDocument();
  });

  it("honors the localStorage dev bypass in dev builds", async () => {
    // Vitest runs with import.meta.env.DEV === true, so the escape hatch is live.
    window.localStorage.setItem("autoflow.mfa.enforcement", "off");
    getMfaPolicyMock.mockResolvedValue(buildPolicy({ hasAnyFactor: false }));
    renderGate();
    await waitFor(() => expect(screen.getByText("protected-content")).toBeInTheDocument());
    expect(screen.queryByText(/enroll-wizard/)).not.toBeInTheDocument();
  });

  it("ignores the localStorage bypass in production builds (still redirects)", async () => {
    vi.stubEnv("DEV", false);
    window.localStorage.setItem("autoflow.mfa.enforcement", "off");
    getMfaPolicyMock.mockResolvedValue(buildPolicy({ hasAnyFactor: false }));
    renderGate("/");
    await waitFor(() => expect(screen.getByText("enroll-wizard:/")).toBeInTheDocument());
    expect(screen.queryByText("protected-content")).not.toBeInTheDocument();
  });
});
