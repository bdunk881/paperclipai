import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LLMProviders from "./LLMProviders";

const listLLMConfigsMock = vi.fn();
const createLLMConfigMock = vi.fn();
const setDefaultLLMConfigMock = vi.fn();
const deleteLLMConfigMock = vi.fn();
const requireAccessTokenMock = vi.fn();

vi.mock("../api/client", () => ({
  listLLMConfigs: () => listLLMConfigsMock(),
  createLLMConfig: (...args: unknown[]) => createLLMConfigMock(...args),
  setDefaultLLMConfig: (...args: unknown[]) => setDefaultLLMConfigMock(...args),
  deleteLLMConfig: (...args: unknown[]) => deleteLLMConfigMock(...args),
  PROVIDER_MODELS: {
    openai: ["gpt-4o", "gpt-4o-mini"],
    anthropic: ["claude-sonnet-4-6"],
    gemini: ["gemini-2.0-flash"],
    mistral: ["mistral-large-latest"],
  },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    requireAccessToken: requireAccessTokenMock,
  }),
}));

function makeConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "cfg-1",
    label: "Primary OpenAI",
    provider: "openai",
    model: "gpt-4o",
    isDefault: true,
    apiKeyMasked: "sk-...1234",
    createdAt: "2026-04-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("LLMProviders", () => {
  beforeEach(() => {
    listLLMConfigsMock.mockReset();
    createLLMConfigMock.mockReset();
    setDefaultLLMConfigMock.mockReset();
    deleteLLMConfigMock.mockReset();
    requireAccessTokenMock.mockReset();
    requireAccessTokenMock.mockResolvedValue("token-123");
  });

  it("renders with v2 structural markers (HEL-63)", async () => {
    listLLMConfigsMock.mockResolvedValue([]);
    const { container } = render(<LLMProviders />);
    await waitFor(() =>
      expect(screen.getByText(/no providers connected yet/i)).toBeInTheDocument()
    );

    expect(container.querySelector(".af2-page")).not.toBeNull();
    expect(container.querySelector(".af2-page-head")).not.toBeNull();
    expect(container.querySelector(".af2-page-actions")).not.toBeNull();
    expect(container.querySelector(".af2-eyebrow")?.textContent).toBe("Connect");
    expect(container.querySelector("h1.af2-h1")?.textContent).toBe("Models");
    expect(screen.getByRole("heading", { level: 3, name: /default routing/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /providers/i })).toBeInTheDocument();
    expect(container.querySelectorAll(".af2-card").length).toBeGreaterThan(0);
  });

  it("shows the backend error when config loading fails", async () => {
    listLLMConfigsMock.mockRejectedValue(new Error("Config fetch failed"));

    render(<LLMProviders />);

    expect(await screen.findByText("Config fetch failed")).toBeInTheDocument();
  });

  it("validates connect form, creates a provider config, and reloads the list", async () => {
    listLLMConfigsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeConfig({ id: "cfg-new", label: "Team OpenAI", isDefault: false }),
      ]);
    createLLMConfigMock.mockResolvedValue(
      makeConfig({ id: "cfg-new", label: "Team OpenAI", isDefault: false })
    );

    render(<LLMProviders />);

    expect(await screen.findByText(/no providers connected yet/i)).toBeInTheDocument();

    // Open the connect modal via "+ Add provider" in the page head.
    fireEvent.click(screen.getByRole("button", { name: /add provider/i }));

    const modalHeading = await screen.findByRole("heading", { name: /connect openai/i });
    const modal = modalHeading.closest("div[class*='bg-af2-card']")?.parentElement;
    if (!modal) throw new Error("Connect modal not found");

    // Submit empty — surface validation errors.
    fireEvent.click(within(modal).getByRole("button", { name: /^connect$/i }));
    expect(screen.getByText("Label is required")).toBeInTheDocument();
    expect(screen.getByText("API key is required")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/my openai key/i), { target: { value: "Team OpenAI" } });
    fireEvent.change(screen.getByPlaceholderText("sk-..."), { target: { value: "sk-test-key" } });
    fireEvent.click(within(modal).getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(createLLMConfigMock).toHaveBeenCalledWith(
        {
          label: "Team OpenAI",
          provider: "openai",
          model: "gpt-4o",
          apiKey: "sk-test-key",
        },
        "token-123"
      );
    });

    // After reload the providers list shows the OpenAI vendor row with the
    // model pill and a Configure action.
    expect(await screen.findByText(/^openai$/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /configure/i }).length).toBeGreaterThan(0);
  });

  it("sets a new default config when the toggle succeeds", async () => {
    listLLMConfigsMock.mockResolvedValue([
      makeConfig(),
      makeConfig({
        id: "cfg-2",
        label: "Backup Anthropic",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        isDefault: false,
        apiKeyMasked: "sk-...5678",
      }),
    ]);
    setDefaultLLMConfigMock.mockResolvedValue(
      makeConfig({
        id: "cfg-2",
        label: "Backup Anthropic",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        isDefault: true,
        apiKeyMasked: "sk-...5678",
      })
    );

    render(<LLMProviders />);

    // Wait for the Anthropic vendor row to render.
    expect(await screen.findByText(/anthropic/i)).toBeInTheDocument();

    // Open the Anthropic Configure modal. There are two Configure buttons
    // (openai + anthropic); pick the one whose row contains "anthropic".
    const configureButtons = screen.getAllByRole("button", { name: /configure/i });
    const anthropicConfigureBtn = configureButtons.find((btn) =>
      btn.closest(".af2-list-row")?.textContent?.toLowerCase().includes("anthropic")
    );
    if (!anthropicConfigureBtn) throw new Error("Anthropic configure button not found");
    fireEvent.click(anthropicConfigureBtn);

    // In the modal, click "Make default" for the non-default Anthropic config.
    const makeDefaultBtn = await screen.findByRole("button", { name: /make default/i });
    fireEvent.click(makeDefaultBtn);

    await waitFor(() => {
      expect(setDefaultLLMConfigMock).toHaveBeenCalledWith("cfg-2", "token-123");
    });

    // After resolution the modal shows the Anthropic config as default.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^default$/i })).toBeDisabled();
    });
  });

  it("reloads configs after a failed default toggle and supports disconnecting a config", async () => {
    listLLMConfigsMock
      .mockResolvedValueOnce([
        makeConfig(),
        makeConfig({
          id: "cfg-2",
          label: "Backup Anthropic",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          isDefault: false,
          apiKeyMasked: "sk-...5678",
        }),
      ])
      .mockResolvedValueOnce([
        makeConfig(),
        makeConfig({
          id: "cfg-2",
          label: "Backup Anthropic",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          isDefault: false,
          apiKeyMasked: "sk-...5678",
        }),
      ])
      .mockResolvedValueOnce([makeConfig()]);
    setDefaultLLMConfigMock.mockRejectedValue(new Error("Set default failed"));
    deleteLLMConfigMock.mockResolvedValue(undefined);

    render(<LLMProviders />);

    expect(await screen.findByText(/anthropic/i)).toBeInTheDocument();

    // Open Anthropic Configure modal.
    const configureButtons = screen.getAllByRole("button", { name: /configure/i });
    const anthropicConfigureBtn = configureButtons.find((btn) =>
      btn.closest(".af2-list-row")?.textContent?.toLowerCase().includes("anthropic")
    );
    if (!anthropicConfigureBtn) throw new Error("Anthropic configure button not found");
    fireEvent.click(anthropicConfigureBtn);

    fireEvent.click(await screen.findByRole("button", { name: /make default/i }));

    await waitFor(() => {
      expect(setDefaultLLMConfigMock).toHaveBeenCalledWith("cfg-2", "token-123");
      expect(listLLMConfigsMock).toHaveBeenCalledTimes(2);
    });

    // The reload re-renders the modal contents; click "Disconnect" on the
    // Anthropic row, then confirm in the DeleteConfirm dialog.
    const disconnectButtons = await screen.findAllByRole("button", { name: /^disconnect$/i });
    fireEvent.click(disconnectButtons[0] as HTMLButtonElement);

    // The confirm modal also has a "Disconnect" button — click the last one,
    // which is inside the confirm modal (rendered on top of the configure
    // modal).
    const confirmDisconnectButtons = screen.getAllByRole("button", { name: /^disconnect$/i });
    fireEvent.click(confirmDisconnectButtons[confirmDisconnectButtons.length - 1] as HTMLButtonElement);

    await waitFor(() => {
      expect(deleteLLMConfigMock).toHaveBeenCalledWith("cfg-2", "token-123");
      expect(listLLMConfigsMock).toHaveBeenCalledTimes(3);
    });

    await waitFor(() => {
      expect(screen.queryByText(/anthropic/i)).not.toBeInTheDocument();
    });
  });
});
