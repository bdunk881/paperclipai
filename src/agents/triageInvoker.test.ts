/**
 * Tests for the LLM-backed triage invoker (HEL-148).
 *
 * The strongest cache-eligibility assertion we can make without a live
 * Anthropic API is: the system prompt is BYTE-IDENTICAL across two calls
 * for the same agent. Anthropic ephemeral caching keys on exact byte
 * match, so any per-call variance in the system block defeats caching.
 *
 * Additionally we verify:
 *   - `cacheSystemPrompt: true` is passed to the provider
 *   - The user prompt carries only event-specific content (no agent ID
 *     leakage into the cacheable prefix)
 *   - Unparseable model replies fall through to a safety-default DEFER
 *   - Missing credentials fall through to the same safety default
 */

// Mock the LLM stack at the module boundary.
const getProviderMock = jest.fn();
const llmConfigStoreMock = {
  getDecryptedDefault: jest.fn(),
};
const resolveModelForTierMock = jest.fn();

jest.mock("../engine/llmProviders", () => ({
  getProvider: (...args: unknown[]) => getProviderMock(...args),
}));

jest.mock("../llmConfig/llmConfigStore", () => ({
  llmConfigStore: {
    getDecryptedDefault: (...args: unknown[]) =>
      llmConfigStoreMock.getDecryptedDefault(...args),
  },
}));

jest.mock("../engine/llmRouter", () => ({
  resolveModelForTier: (...args: unknown[]) => resolveModelForTierMock(...args),
}));

import {
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  createLlmTriageInvoker,
} from "./triageInvoker";
import type { TriageInvokeInput } from "./triagePolicy";
import type { Pool } from "pg";

const POOL = {} as Pool;
const USER_ID = "user-1";
const WORKSPACE_ID = "workspace-1";

const AGENT_CARD = `Name: Aaron Chen
Role: Customer Success Manager
Mandate: Keep our largest customers healthy and renewing.`;

const POLICY_BODY = `ACT on @-mentions.
DEFER on cron events.
ESCALATE to CSM-lead on auth-failure events.`;

function makeEvent(overrides: Partial<TriageInvokeInput["event"]> = {}): TriageInvokeInput["event"] {
  return {
    source: "mention",
    sourceRef: "comment-99",
    summary: "User @-mentioned the CSM in a support thread",
    payload: { messageId: "msg-1" },
    ...overrides,
  };
}

function setupLlmStack(responseText: string, usage = { promptTokens: 1200, completionTokens: 30 }): void {
  llmConfigStoreMock.getDecryptedDefault.mockResolvedValue({
    config: { provider: "anthropic" },
    apiKey: "sk-test-123",
  });
  resolveModelForTierMock.mockReturnValue("claude-haiku");
  const providerFn = jest.fn().mockResolvedValue({
    text: responseText,
    usage,
  });
  getProviderMock.mockReturnValue(providerFn);
  return providerFn as unknown as void;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("buildTriageSystemPrompt", () => {
  it("produces a byte-identical string for the same agent across calls (HEL-148 cache-eligibility)", () => {
    // The exact-bytes assertion is the strongest pre-API cache check
    // we can make. If this fails, Anthropic's cache would miss every
    // call and the cost guard is gone.
    const first = buildTriageSystemPrompt(AGENT_CARD, POLICY_BODY);
    const second = buildTriageSystemPrompt(AGENT_CARD, POLICY_BODY);
    expect(first).toBe(second);
    // Sanity: it's actually doing the join (not returning empty).
    expect(first.length).toBeGreaterThan(100);
    expect(first).toContain("AGENT IDENTITY CARD");
    expect(first).toContain("TRIAGE POLICY");
    expect(first).toContain("OUTPUT FORMAT");
  });

  it("varies when the agent identity card changes (different agent → different cache key)", () => {
    const a = buildTriageSystemPrompt("agent A card", POLICY_BODY);
    const b = buildTriageSystemPrompt("agent B card", POLICY_BODY);
    expect(a).not.toBe(b);
  });

  it("trims leading/trailing whitespace from inputs so caller-side formatting variance doesn't bust the cache", () => {
    const tight = buildTriageSystemPrompt(AGENT_CARD, POLICY_BODY);
    const loose = buildTriageSystemPrompt(`  ${AGENT_CARD}\n\n`, `${POLICY_BODY}   `);
    // The trim() calls inside the builder produce identical output even
    // if the caller's `loadTriagePolicy` returns a value with stray
    // whitespace.
    expect(tight).toBe(loose);
  });
});

describe("buildTriageUserPrompt", () => {
  it("includes the event source, sourceRef, summary, and payload", () => {
    const out = buildTriageUserPrompt(makeEvent());
    expect(out).toContain("source: mention");
    expect(out).toContain("sourceRef: comment-99");
    expect(out).toContain("User @-mentioned");
    expect(out).toContain("msg-1");
  });

  it("does NOT include any agent-identity fields (those belong to the cached system prompt)", () => {
    // The user prompt is the variable part of every call. If agent
    // metadata leaked into it, calls for the same agent against
    // different events would produce a different *cacheable* prefix
    // shape, defeating the cache.
    const out = buildTriageUserPrompt(makeEvent());
    expect(out).not.toContain(AGENT_CARD);
    expect(out).not.toContain("Customer Success Manager");
    expect(out).not.toContain("AGENT IDENTITY CARD");
  });
});

describe("createLlmTriageInvoker", () => {
  it("passes cacheSystemPrompt:true to the provider (HEL-148 acceptance #1)", async () => {
    setupLlmStack(
      '{"decision":"ACT","reason":"user mention","escalatedTo":null,"deferredUntil":null}',
    );
    const invoker = createLlmTriageInvoker({
      pool: POOL,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });
    await invoker({ agentIdentityCard: AGENT_CARD, policyBody: POLICY_BODY, event: makeEvent() });

    expect(getProviderMock).toHaveBeenCalledTimes(1);
    const providerConfig = getProviderMock.mock.calls[0]![0];
    expect(providerConfig.cacheSystemPrompt).toBe(true);
    expect(providerConfig.systemPrompt).toContain("AGENT IDENTITY CARD");
  });

  it("sends a byte-identical systemPrompt across two calls for the same agent", async () => {
    setupLlmStack(
      '{"decision":"ACT","reason":"mention","escalatedTo":null,"deferredUntil":null}',
    );
    const invoker = createLlmTriageInvoker({
      pool: POOL,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });

    await invoker({ agentIdentityCard: AGENT_CARD, policyBody: POLICY_BODY, event: makeEvent() });
    await invoker({
      agentIdentityCard: AGENT_CARD,
      policyBody: POLICY_BODY,
      event: makeEvent({ summary: "different event entirely" }),
    });

    const firstSystem = getProviderMock.mock.calls[0]![0].systemPrompt;
    const secondSystem = getProviderMock.mock.calls[1]![0].systemPrompt;
    expect(firstSystem).toBe(secondSystem);
  });

  it("parses a valid JSON reply into the structured TriageInvokeOutput", async () => {
    setupLlmStack(
      '{"decision":"ESCALATE","reason":"compliance flag detected","escalatedTo":"agent-csm-lead","deferredUntil":null}',
      { promptTokens: 1200, completionTokens: 40 },
    );
    const invoker = createLlmTriageInvoker({
      pool: POOL,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });

    const result = await invoker({
      agentIdentityCard: AGENT_CARD,
      policyBody: POLICY_BODY,
      event: makeEvent({ summary: "auth failure on production" }),
    });

    expect(result.decision).toBe("ESCALATE");
    expect(result.reason).toBe("compliance flag detected");
    expect(result.escalatedTo).toBe("agent-csm-lead");
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("parses code-fenced JSON (```json ... ```)", async () => {
    setupLlmStack('```json\n{"decision":"DEFER","reason":"low signal","escalatedTo":null,"deferredUntil":"2026-05-21T00:00:00Z"}\n```');
    const invoker = createLlmTriageInvoker({
      pool: POOL,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });

    const result = await invoker({
      agentIdentityCard: AGENT_CARD,
      policyBody: POLICY_BODY,
      event: makeEvent({ source: "cron" }),
    });

    expect(result.decision).toBe("DEFER");
    expect(result.deferredUntil).toBe("2026-05-21T00:00:00Z");
  });

  it("falls back to DEFER 1h when the model's reply is unparseable", async () => {
    setupLlmStack("I think we should ACT on this. The user seems frustrated.");
    const invoker = createLlmTriageInvoker({
      pool: POOL,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });

    const result = await invoker({
      agentIdentityCard: AGENT_CARD,
      policyBody: POLICY_BODY,
      event: makeEvent(),
    });

    expect(result.decision).toBe("DEFER");
    expect(result.reason).toMatch(/unparseable/i);
    expect(result.deferredUntil).toBeTruthy();
    expect(new Date(result.deferredUntil!).getTime()).toBeGreaterThan(Date.now());
  });

  it("falls back to DEFER 1h when no LLM credential is configured", async () => {
    llmConfigStoreMock.getDecryptedDefault.mockResolvedValue(null);
    const invoker = createLlmTriageInvoker({
      pool: POOL,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });

    const result = await invoker({
      agentIdentityCard: AGENT_CARD,
      policyBody: POLICY_BODY,
      event: makeEvent(),
    });

    expect(result.decision).toBe("DEFER");
    expect(result.reason).toMatch(/credential not configured/i);
    expect(result.costUsd).toBe(0);
    expect(getProviderMock).not.toHaveBeenCalled();
  });

  it("falls back to DEFER 1h when the provider call throws", async () => {
    llmConfigStoreMock.getDecryptedDefault.mockResolvedValue({
      config: { provider: "anthropic" },
      apiKey: "sk-test-123",
    });
    resolveModelForTierMock.mockReturnValue("claude-haiku");
    getProviderMock.mockReturnValue(
      jest.fn().mockRejectedValue(new Error("anthropic 503 service unavailable")),
    );

    const invoker = createLlmTriageInvoker({
      pool: POOL,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });

    const result = await invoker({
      agentIdentityCard: AGENT_CARD,
      policyBody: POLICY_BODY,
      event: makeEvent(),
    });

    expect(result.decision).toBe("DEFER");
    expect(result.reason).toMatch(/503 service unavailable/i);
    expect(result.costUsd).toBe(0);
  });

  it("rejects a parsed object with an unknown decision enum value", async () => {
    setupLlmStack('{"decision":"PROCRASTINATE","reason":"???","escalatedTo":null}');
    const invoker = createLlmTriageInvoker({
      pool: POOL,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });

    const result = await invoker({
      agentIdentityCard: AGENT_CARD,
      policyBody: POLICY_BODY,
      event: makeEvent(),
    });

    // PROCRASTINATE isn't a valid decision → parser returns null →
    // safety-default DEFER fires.
    expect(result.decision).toBe("DEFER");
  });

  it("uses the lite tier by default and resolves the model accordingly", async () => {
    setupLlmStack('{"decision":"ACT","reason":"x","escalatedTo":null,"deferredUntil":null}');
    const invoker = createLlmTriageInvoker({
      pool: POOL,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });
    await invoker({ agentIdentityCard: AGENT_CARD, policyBody: POLICY_BODY, event: makeEvent() });

    expect(resolveModelForTierMock).toHaveBeenCalledWith("anthropic", "lite");
  });

  it("honors an explicit tier override", async () => {
    setupLlmStack('{"decision":"ACT","reason":"x","escalatedTo":null,"deferredUntil":null}');
    const invoker = createLlmTriageInvoker({
      pool: POOL,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      tier: "standard",
    });
    await invoker({ agentIdentityCard: AGENT_CARD, policyBody: POLICY_BODY, event: makeEvent() });

    expect(resolveModelForTierMock).toHaveBeenCalledWith("anthropic", "standard");
  });

  it("caps output tokens at 300 by default (triage replies are tiny JSON)", async () => {
    setupLlmStack('{"decision":"ACT","reason":"x","escalatedTo":null,"deferredUntil":null}');
    const invoker = createLlmTriageInvoker({
      pool: POOL,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });
    await invoker({ agentIdentityCard: AGENT_CARD, policyBody: POLICY_BODY, event: makeEvent() });

    const providerConfig = getProviderMock.mock.calls[0]![0];
    expect(providerConfig.maxOutputTokens).toBe(300);
  });
});
