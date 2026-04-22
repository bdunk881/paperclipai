import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LLMProviders from "./LLMProviders";

const listLLMConfigsMock = vi.fn();
const createLLMConfigMock = vi.fn();
const setDefaultLLMConfigMock = vi.fn();
const deleteLLMConfigMock = vi.fn();

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

function makeConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "cfg-1",
    label: "Primary OpenAI",
    provider: "openai",
    model: "gpt-4o",
    isDefault: true,
    maskedApiKey: "sk-...1234",
    createdAt: "2026-04-22T00:00:00.000Z",
    ...overrides,
  };
}

function getBodyRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll("tbody tr"));
}

describe("LLMProviders", () => {
  beforeEach(() => {
    listLLMConfigsMock.mockReset();
    createLLMConfigMock.mockReset();
    setDefaultLLMConfigMock.mockReset();
    deleteLLMConfigMock.mockReset();
  });

  it("shows the backend error when config loading fails", async () => {
    listLLMConfigsMock.mockRejectedValue(new Error("Config fetch failed"));

    render(<LLMProviders />);

    expect(await screen.findByText("Config fetch failed")).toBeInTheDocument();
  });

  it("validates connect form, creates a provider config, and reloads the table", async () => {
    listLLMConfigsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeConfig({ id: "cfg-new", label: "Team OpenAI", isDefault: false }),
      ]);
    createLLMConfigMock.mockResolvedValue(makeConfig({ id: "cfg-new", label: "Team OpenAI", isDefault: false }));

    render(<LLMProviders />);

    expect(await screen.findByText(/no providers connected yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /^connect$/i })[0]);

    const modal = screen.getByRole("heading", { name: /connect openai/i }).closest("div[class*='bg-white']")?.parentElement;
    if (!modal) throw new Error("Connect modal not found");

    fireEvent.click(within(modal).getByRole("button", { name: /^connect$/i }));

    expect(screen.getByText("Label is required")).toBeInTheDocument();
    expect(screen.getByText("API key is required")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/my openai key/i), { target: { value: "Team OpenAI" } });
    fireEvent.change(screen.getByPlaceholderText("sk-..."), { target: { value: "sk-test-key" } });
    fireEvent.click(within(modal).getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(createLLMConfigMock).toHaveBeenCalledWith({
        label: "Team OpenAI",
        provider: "openai",
        model: "gpt-4o",
        apiKey: "sk-test-key",
      });
    });

    expect(await screen.findByText("Team OpenAI")).toBeInTheDocument();
    expect(screen.getByText("sk-...1234")).toBeInTheDocument();
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
        maskedApiKey: "sk-...5678",
      }),
    ]);
    setDefaultLLMConfigMock.mockResolvedValue(makeConfig({
      id: "cfg-2",
      label: "Backup Anthropic",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      isDefault: true,
      maskedApiKey: "sk-...5678",
    }));

    const { container } = render(<LLMProviders />);

    expect(await screen.findByText("Backup Anthropic")).toBeInTheDocument();

    const secondRowButton = getBodyRows(container)[1]?.querySelector("td:nth-child(5) button") as HTMLButtonElement;
    fireEvent.click(secondRowButton);

    await waitFor(() => {
      expect(setDefaultLLMConfigMock).toHaveBeenCalledWith("cfg-2");
    });

    await waitFor(() => {
      const rows = getBodyRows(container);
      expect((rows[0]?.querySelector("td:nth-child(5) button") as HTMLButtonElement).disabled).toBe(false);
      expect((rows[1]?.querySelector("td:nth-child(5) button") as HTMLButtonElement).disabled).toBe(true);
      expect(rows[1]?.querySelector("td:nth-child(5) button")?.getAttribute("title")).toBe("Default config");
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
          maskedApiKey: "sk-...5678",
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
          maskedApiKey: "sk-...5678",
        }),
      ])
      .mockResolvedValueOnce([
        makeConfig(),
      ]);
    setDefaultLLMConfigMock.mockRejectedValue(new Error("Set default failed"));
    deleteLLMConfigMock.mockResolvedValue(undefined);

    const { container } = render(<LLMProviders />);

    expect(await screen.findByText("Backup Anthropic")).toBeInTheDocument();

    fireEvent.click(getBodyRows(container)[1]?.querySelector("td:nth-child(5) button") as HTMLButtonElement);

    await waitFor(() => {
      expect(setDefaultLLMConfigMock).toHaveBeenCalledWith("cfg-2");
      expect(listLLMConfigsMock).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(getBodyRows(container)[1]?.querySelector("td:last-child button") as HTMLButtonElement);
    const disconnectButtons = screen.getAllByRole("button", { name: /^disconnect$/i });
    fireEvent.click(disconnectButtons[disconnectButtons.length - 1] as HTMLButtonElement);

    await waitFor(() => {
      expect(deleteLLMConfigMock).toHaveBeenCalledWith("cfg-2");
      expect(listLLMConfigsMock).toHaveBeenCalledTimes(3);
    });

    await waitFor(() => {
      expect(screen.queryByText("Backup Anthropic")).not.toBeInTheDocument();
    });
  });
});
