/**
 * Coverage for the agent self-check-in helper (UX-12).
 *
 * Focused on the deterministic bits: prompt construction (so the
 * model gets agent name + role + the right ticket subset) and
 * runtime presence updates given mocked LLM output. The
 * fire-and-forget executeSelfCheckIn path is exercised through
 * runAgentSelfCheckIn — error swallow contract checked too.
 */

jest.mock("../engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

jest.mock("../llmConfig/llmConfigStore", () => ({
  llmConfigStore: { getDecryptedDefault: jest.fn() },
}));

jest.mock("../tickets/ticketStore", () => ({
  ticketStore: { list: jest.fn() },
}));

jest.mock("./agentPresence", () => ({
  setAgentPresence: jest.fn().mockResolvedValue(undefined),
}));

import { buildPrompt, runAgentSelfCheckIn } from "./agentCheckIn";
import { getProvider } from "../engine/llmProviders";
import { llmConfigStore } from "../llmConfig/llmConfigStore";
import { ticketStore } from "../tickets/ticketStore";
import { setAgentPresence } from "./agentPresence";

const mockGetProvider = getProvider as jest.Mock;
const mockGetDecrypted = llmConfigStore.getDecryptedDefault as jest.Mock;
const mockTicketList = ticketStore.list as jest.Mock;
const mockSetPresence = setAgentPresence as jest.Mock;

const POOL = { query: jest.fn() } as unknown as Parameters<typeof runAgentSelfCheckIn>[0]["pool"];

beforeEach(() => {
  mockGetProvider.mockReset();
  mockGetDecrypted.mockReset();
  mockTicketList.mockReset();
  mockSetPresence.mockReset();
  mockSetPresence.mockResolvedValue(undefined);
});

describe("buildPrompt", () => {
  it("embeds the agent name + role + each ticket title with status & priority", () => {
    const prompt = buildPrompt({
      agentName: "Aaron Chen",
      agentRoleKey: "customer_success_lead",
      openTickets: [
        { title: "Acme renewal follow-up", status: "in_progress", priority: "high" },
        { title: "Triage Zendesk #4127", status: "open", priority: "urgent" },
      ],
    });
    expect(prompt).toContain("Aaron Chen");
    expect(prompt).toContain("customer_success_lead");
    expect(prompt).toContain("Acme renewal follow-up");
    expect(prompt).toContain("in_progress, high priority");
    expect(prompt).toContain("Triage Zendesk #4127");
    expect(prompt).toContain("urgent priority");
    expect(prompt).toContain('"state":');
    expect(prompt).toContain('"summary":');
  });

  it("uses the '(no open mission assignments)' placeholder for an empty queue", () => {
    const prompt = buildPrompt({
      agentName: "Aaron",
      agentRoleKey: null,
      openTickets: [],
    });
    expect(prompt).toContain("(no open mission assignments)");
    expect(prompt).toContain("operator"); // role fallback
  });
});

describe("runAgentSelfCheckIn (fire-and-forget)", () => {
  function happyInput() {
    return {
      pool: POOL,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      agentId: "22222222-2222-4222-8222-222222222222",
      agentName: "Aaron",
      agentRoleKey: "customer_success_lead",
    };
  }

  async function waitForMicrotasks(): Promise<void> {
    // The function is fire-and-forget but we need to let its inner
    // promise chain settle so our assertions see the side effects.
    // Two flushes covers the typical await ticketStore.list ->
    // await getDecryptedDefault -> await provider() -> await
    // setAgentPresence chain.
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }
  }

  it("calls setAgentPresence with the LLM's reported state + summary", async () => {
    mockTicketList.mockResolvedValueOnce([
      {
        title: "Acme renewal",
        status: "in_progress",
        priority: "high",
        assignees: [],
        workspaceId: "ws",
        id: "t1",
        creatorId: "u",
        description: "",
        slaState: "on_track",
        createdAt: "",
        updatedAt: "",
        tags: [],
      },
    ]);
    mockGetDecrypted.mockResolvedValueOnce({
      config: { provider: "anthropic", model: "claude-sonnet-4-6" },
      apiKey: "k",
    });
    const fakeProvider = jest.fn().mockResolvedValueOnce({
      text: '{"state":"working","summary":"Following up on the Acme renewal."}',
    });
    mockGetProvider.mockReturnValueOnce(fakeProvider);

    runAgentSelfCheckIn(happyInput());
    await new Promise((r) => setTimeout(r, 20));
    await waitForMicrotasks();

    expect(mockSetPresence).toHaveBeenCalledWith({
      workspaceId: happyInput().workspaceId,
      agentId: happyInput().agentId,
      state: "working",
      currentTask: "Following up on the Acme renewal.",
    });
  });

  it("does nothing when no LLM provider is configured (just logs)", async () => {
    mockTicketList.mockResolvedValueOnce([]);
    mockGetDecrypted.mockResolvedValueOnce(null);
    // Make sure provider was never asked for, so a future regression
    // that calls getProvider() without checking the resolved config
    // fails this test.
    runAgentSelfCheckIn(happyInput());
    await new Promise((r) => setTimeout(r, 20));
    await waitForMicrotasks();

    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(mockSetPresence).not.toHaveBeenCalled();
  });

  it("swallows ticket-list failures and still runs the LLM call with empty queue", async () => {
    mockTicketList.mockRejectedValueOnce(new Error("rls: not allowed"));
    mockGetDecrypted.mockResolvedValueOnce({
      config: { provider: "anthropic", model: "claude-sonnet-4-6" },
      apiKey: "k",
    });
    const fakeProvider = jest.fn().mockResolvedValueOnce({
      text: '{"state":"idle","summary":"Queue is empty. Awaiting next mission."}',
    });
    mockGetProvider.mockReturnValueOnce(fakeProvider);

    runAgentSelfCheckIn(happyInput());
    await new Promise((r) => setTimeout(r, 20));
    await waitForMicrotasks();

    expect(fakeProvider).toHaveBeenCalled();
    expect(mockSetPresence).toHaveBeenCalledWith(
      expect.objectContaining({ state: "idle" }),
    );
  });

  it("swallows LLM failures without throwing (presence stays untouched)", async () => {
    mockTicketList.mockResolvedValueOnce([]);
    mockGetDecrypted.mockResolvedValueOnce({
      config: { provider: "anthropic", model: "claude-sonnet-4-6" },
      apiKey: "k",
    });
    mockGetProvider.mockReturnValueOnce(
      jest.fn().mockRejectedValueOnce(new Error("provider 500")),
    );

    // Capture unhandled rejections — should be zero.
    const handler = jest.fn();
    process.on("unhandledRejection", handler);
    runAgentSelfCheckIn(happyInput());
    await new Promise((r) => setTimeout(r, 20));
    await waitForMicrotasks();
    process.off("unhandledRejection", handler);

    expect(handler).not.toHaveBeenCalled();
    expect(mockSetPresence).not.toHaveBeenCalled();
  });

  it("ignores malformed LLM output (no presence update)", async () => {
    mockTicketList.mockResolvedValueOnce([]);
    mockGetDecrypted.mockResolvedValueOnce({
      config: { provider: "anthropic", model: "claude-sonnet-4-6" },
      apiKey: "k",
    });
    mockGetProvider.mockReturnValueOnce(
      jest.fn().mockResolvedValueOnce({ text: "Sure! Aaron is fine." }),
    );

    runAgentSelfCheckIn(happyInput());
    await new Promise((r) => setTimeout(r, 20));
    await waitForMicrotasks();

    expect(mockSetPresence).not.toHaveBeenCalled();
  });

  it("clamps long LLM summaries to the 240-char cap", async () => {
    mockTicketList.mockResolvedValueOnce([]);
    mockGetDecrypted.mockResolvedValueOnce({
      config: { provider: "anthropic", model: "claude-sonnet-4-6" },
      apiKey: "k",
    });
    const long = "x".repeat(800);
    mockGetProvider.mockReturnValueOnce(
      jest.fn().mockResolvedValueOnce({
        text: `{"state":"working","summary":"${long}"}`,
      }),
    );

    runAgentSelfCheckIn(happyInput());
    await new Promise((r) => setTimeout(r, 20));
    await waitForMicrotasks();

    const call = mockSetPresence.mock.calls[0]?.[0] as { currentTask?: string };
    expect(call?.currentTask?.length).toBeLessThanOrEqual(240);
  });
});
