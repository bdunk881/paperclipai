import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAccessTokenMock, toastMock, api } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  api: {
    fetchComposioToolkits: vi.fn(),
    listComposioConnections: vi.fn(),
    startComposioConnect: vi.fn(),
    disconnectComposio: vi.fn(),
  },
}));

vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ getAccessToken: getAccessTokenMock }) }));
vi.mock("../components/ToastProvider", () => ({ useToast: () => toastMock }));
vi.mock("../api/composioApi", () => api);

import ComposioConnectionsPanel from "./ComposioConnectionsPanel";

function toolkit(slug: string, name: string) {
  return {
    slug,
    name,
    logo: null,
    description: `${name} description`,
    categories: [],
    toolsCount: 10,
    triggersCount: 1,
    authSchemes: ["OAUTH2"],
    composioManagedAuthSchemes: ["OAUTH2"],
    noAuth: false,
  };
}

describe("ComposioConnectionsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessTokenMock.mockResolvedValue("tok");
    api.fetchComposioToolkits.mockResolvedValue({
      toolkits: [toolkit("github", "GitHub"), toolkit("slack", "Slack")],
      total: 2,
      nextCursor: null,
    });
    api.listComposioConnections.mockResolvedValue([
      {
        connectedAccountId: "ca_slack",
        toolkit: "slack",
        status: "ACTIVE",
        authConfigId: "ac",
        createdAt: "",
        updatedAt: "",
      },
    ]);
    api.startComposioConnect.mockResolvedValue({
      redirectUrl: null,
      connectedAccountId: "ca_gh",
      toolkit: "github",
    });
    api.disconnectComposio.mockResolvedValue(undefined);
  });

  it("renders the catalog joined with connection status (connectableOnly)", async () => {
    render(<ComposioConnectionsPanel />);

    expect(await screen.findByText("GitHub")).toBeTruthy();
    expect(screen.getByText("Slack")).toBeTruthy();
    // slack is the connected one
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(api.fetchComposioToolkits).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({ connectableOnly: true }),
    );
  });

  it("shows Connect for unconnected and Disconnect for connected toolkits", async () => {
    render(<ComposioConnectionsPanel />);
    await screen.findByText("GitHub");

    // github (unconnected) → Connect; slack (connected) → Disconnect
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(api.startComposioConnect).toHaveBeenCalledWith("tok", "github"));

    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("disconnects the connected toolkit", async () => {
    render(<ComposioConnectionsPanel />);
    await screen.findByText("Slack");

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(api.disconnectComposio).toHaveBeenCalledWith("tok", "ca_slack"));
  });

  it("surfaces an error with a retry", async () => {
    api.fetchComposioToolkits.mockRejectedValueOnce(new Error("boom"));
    render(<ComposioConnectionsPanel />);
    expect(await screen.findByText("boom")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
