import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ApiKeys from "./ApiKeys";

const listApiKeysMock = vi.fn();
const createApiKeyMock = vi.fn();
const rotateApiKeyMock = vi.fn();
const revokeApiKeyMock = vi.fn();
const requireAccessTokenMock = vi.fn();

vi.mock("../api/client", () => ({
  listApiKeys: (...args: unknown[]) => listApiKeysMock(...args),
  createApiKey: (...args: unknown[]) => createApiKeyMock(...args),
  rotateApiKey: (...args: unknown[]) => rotateApiKeyMock(...args),
  revokeApiKey: (...args: unknown[]) => revokeApiKeyMock(...args),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    requireAccessToken: requireAccessTokenMock,
  }),
}));

function makeKey(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "key-1",
    workspaceId: "workspace-1",
    name: "Production automation",
    maskedKey: "afk_live...1234",
    createdByUserId: "user-1",
    rotatedFromKeyId: null,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: "2026-05-19T00:00:00.000Z",
    updatedAt: "2026-05-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("ApiKeys", () => {
  beforeEach(() => {
    listApiKeysMock.mockReset();
    createApiKeyMock.mockReset();
    rotateApiKeyMock.mockReset();
    revokeApiKeyMock.mockReset();
    requireAccessTokenMock.mockReset();
    requireAccessTokenMock.mockResolvedValue("token-123");
  });

  it("creates a key, reloads the list, and displays the one-time secret", async () => {
    const createdKey = makeKey();
    listApiKeysMock.mockResolvedValueOnce([]).mockResolvedValueOnce([createdKey]);
    createApiKeyMock.mockResolvedValue({ key: createdKey, secret: "afk_secret_once" });

    render(<ApiKeys />);

    expect(await screen.findByText("No API keys yet.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Production automation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => {
      expect(createApiKeyMock).toHaveBeenCalledWith(
        { name: "Production automation" },
        "token-123",
      );
    });
    expect(await screen.findByLabelText("New API key secret")).toHaveValue("afk_secret_once");
    expect(await screen.findByText("Production automation")).toBeInTheDocument();
  });

  it("rotates and revokes active keys", async () => {
    const original = makeKey();
    const replacement = makeKey({
      id: "key-2",
      maskedKey: "afk_live...5678",
      rotatedFromKeyId: "key-1",
    });
    listApiKeysMock
      .mockResolvedValueOnce([original])
      .mockResolvedValueOnce([replacement, makeKey({ revokedAt: "2026-05-19T01:00:00.000Z" })])
      .mockResolvedValueOnce([{ ...replacement, revokedAt: "2026-05-19T02:00:00.000Z" }]);
    rotateApiKeyMock.mockResolvedValue({ key: replacement, secret: "afk_rotated_once" });
    revokeApiKeyMock.mockResolvedValue(undefined);

    render(<ApiKeys />);

    expect(await screen.findByText("Production automation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rotate Production automation" }));

    await waitFor(() => {
      expect(rotateApiKeyMock).toHaveBeenCalledWith("key-1", "token-123");
    });
    expect(await screen.findByLabelText("New API key secret")).toHaveValue("afk_rotated_once");

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Revoke Production automation" })).toHaveLength(2);
    });
    const activeRevoke = screen
      .getAllByRole("button", { name: "Revoke Production automation" })
      .find((button) => !(button as HTMLButtonElement).disabled);
    if (!activeRevoke) throw new Error("Enabled revoke button not found");
    fireEvent.click(activeRevoke);
    await waitFor(() => {
      expect(revokeApiKeyMock).toHaveBeenCalledWith("key-2", "token-123");
    });
  });

  it("shows load and validation errors", async () => {
    listApiKeysMock.mockRejectedValue(new Error("API unavailable"));
    render(<ApiKeys />);
    expect(await screen.findByText("API unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect(screen.getByText("Name is required")).toBeInTheDocument();
  });
});
