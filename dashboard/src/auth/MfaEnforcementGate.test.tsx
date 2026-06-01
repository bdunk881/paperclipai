import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

describe("MfaEnforcementGate (HEL-389 hard gate)", () => {
  beforeEach(() => {
    requireAccessTokenMock.mockResolvedValue("access-token");
    window.localStorage.removeItem("autoflow.mfa.enforcement");
  });

  afterEach(() => {
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

  // The core fix: no factor → hard redirect to the standalone wizard, and the
  // protected dashboard (which would carry the Ctrl+K command palette) is
  // NEVER rendered.
  it("hard-redirects to /onboarding/mfa (carrying state.from) when policy says no factors", async () => {
    getMfaPolicyMock.mockResolvedValue(buildPolicy());
    renderGate("/");
    await waitFor(() => expect(screen.getByText("enroll-wizard:/")).toBeInTheDocument());
    expect(screen.queryByText("protected-content")).not.toBeInTheDocument();
  });

  it("fails open and renders children if the policy fetch errors out", async () => {
    getMfaPolicyMock.mockRejectedValue(new Error("network down"));
    renderGate();
    await waitFor(() => expect(screen.getByText("protected-content")).toBeInTheDocument());
    expect(screen.queryByText(/enroll-wizard/)).not.toBeInTheDocument();
  });

  it("renders children when an OAuth user has no factors but requiresAppMfa=false", async () => {
    getMfaPolicyMock.mockResolvedValue(
      buildPolicy({ signInMethod: "oauth_google", requiresAppMfa: false }),
    );
    renderGate();
    await waitFor(() => expect(screen.getByText("protected-content")).toBeInTheDocument());
    expect(screen.queryByText(/enroll-wizard/)).not.toBeInTheDocument();
  });

  it("redirects an OAuth user when requiresAppMfa=true (enterprise override)", async () => {
    getMfaPolicyMock.mockResolvedValue(
      buildPolicy({ signInMethod: "oauth_google", requiresAppMfa: true }),
    );
    renderGate();
    await waitFor(() => expect(screen.getByText("enroll-wizard:/")).toBeInTheDocument());
    expect(screen.queryByText("protected-content")).not.toBeInTheDocument();
  });

  it("honors the localStorage dev bypass in dev builds", async () => {
    // Vitest runs with import.meta.env.DEV === true, so the escape hatch is live.
    window.localStorage.setItem("autoflow.mfa.enforcement", "off");
    getMfaPolicyMock.mockResolvedValue(buildPolicy());
    renderGate();
    await waitFor(() => expect(screen.getByText("protected-content")).toBeInTheDocument());
    expect(screen.queryByText(/enroll-wizard/)).not.toBeInTheDocument();
  });

  it("ignores the localStorage bypass in production builds (still hard-redirects)", async () => {
    vi.stubEnv("DEV", false);
    window.localStorage.setItem("autoflow.mfa.enforcement", "off");
    getMfaPolicyMock.mockResolvedValue(buildPolicy());
    renderGate();
    await waitFor(() => expect(screen.getByText("enroll-wizard:/")).toBeInTheDocument());
    expect(screen.queryByText("protected-content")).not.toBeInTheDocument();
  });
});
