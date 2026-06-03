/**
 * HEL-439: explicit-id LLM resolution must be DB-backed (async), not the sync
 * in-memory getter. The sync getter reads only a process-local cache, so a
 * cold process (post-deploy/restart) or an instance that didn't handle the
 * write would miss and the hire flow would 422 ("LLM configuration not found
 * or unavailable") even though the credential is in Postgres.
 */
import { resolveHiringPlanLlm } from "./resolveHiringPlanLlm";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import type { DecryptedLLMConfig } from "../llmConfig/llmConfigStore";

jest.mock("../llmConfig/llmConfigStore", () => ({
  llmConfigStore: {
    // Simulate a COLD in-memory bucket: the sync getter finds nothing...
    getDecrypted: jest.fn(() => undefined),
    // ...but the DB-backed async getter resolves the record from Postgres.
    getDecryptedAsync: jest.fn(),
    listAsync: jest.fn(async () => []),
    getDecryptedDefaultAsync: jest.fn(async () => undefined),
  },
}));

const mockStore = llmConfigStore as jest.Mocked<typeof llmConfigStore>;

const FAKE_CONFIG: DecryptedLLMConfig = {
  config: {
    id: "cfg-123",
    userId: "user-1",
    provider: "gemini",
    label: "Google Gemini primary",
    model: "gemini-2.5-pro",
    credentialSummary: { apiKeyMasked: "****abcd" },
    isDefault: true,
    createdAt: "2026-06-03T00:00:00.000Z",
  },
  credentials: { apiKey: "secret-key" },
  apiKey: "secret-key",
};

describe("resolveHiringPlanLlm (HEL-439)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves an explicit BYOK id via the async DB-backed getter (survives a cold in-memory cache)", async () => {
    mockStore.getDecryptedAsync.mockResolvedValue(FAKE_CONFIG);

    const result = await resolveHiringPlanLlm("user-1", "cfg-123");

    expect(mockStore.getDecryptedAsync).toHaveBeenCalledWith("cfg-123", "user-1");
    // The sync getter must NOT be used for the explicit-id path anymore — that
    // was the bug (it only sees records written in the current process).
    expect(mockStore.getDecrypted).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.llmConfigId).toBe("cfg-123");
    expect(result?.assemblyModel).toBe("gemini-2.5-pro");
    expect(result?.resolved).toBe(FAKE_CONFIG);
  });

  it("returns null when the async getter can't find the explicit id", async () => {
    mockStore.getDecryptedAsync.mockResolvedValue(undefined);

    const result = await resolveHiringPlanLlm("user-1", "missing-id");

    expect(mockStore.getDecryptedAsync).toHaveBeenCalledWith("missing-id", "user-1");
    expect(result).toBeNull();
  });
});
