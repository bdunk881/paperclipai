import { applyAgentSubNodes, parseAgentSubNodes, type AgentSubNode } from "./agentSubNodes";
import type { WorkflowStep } from "../types/workflow";

function agentStep(config?: Record<string, unknown>, extra?: Partial<WorkflowStep>): WorkflowStep {
  return {
    id: "a1",
    name: "Agent",
    kind: "agent",
    description: "",
    inputKeys: [],
    outputKeys: [],
    ...(config ? { config } : {}),
    ...extra,
  };
}

function subNodes(...nodes: Array<Partial<AgentSubNode>>): Record<string, unknown> {
  return { subNodes: nodes };
}

describe("parseAgentSubNodes (HEL-815)", () => {
  it("reads valid entries and skips malformed / unknown kinds", () => {
    const step = agentStep({
      subNodes: [
        { id: "m1", kind: "model", config: { llmConfigId: "cfg-1" } },
        { kind: "tool", config: { skill: "slack" } }, // id defaulted
        { kind: "bogus", config: {} }, // unknown kind dropped
        "nope", // non-object dropped
        { kind: "memory" }, // config defaulted to {}
      ],
    });
    const parsed = parseAgentSubNodes(step);
    expect(parsed.map((p) => p.kind)).toEqual(["model", "tool", "memory"]);
    expect(parsed[0]!.id).toBe("m1");
    expect(parsed[1]!.id).toBe("tool-1");
    expect(parsed[2]!.config).toEqual({});
  });

  it("returns [] when there are no sub-nodes", () => {
    expect(parseAgentSubNodes(agentStep())).toEqual([]);
    expect(parseAgentSubNodes(agentStep({ subNodes: "x" }))).toEqual([]);
  });
});

describe("applyAgentSubNodes (HEL-815)", () => {
  it("returns the same step for non-agent kinds", () => {
    const step = { ...agentStep(subNodes({ kind: "model", config: { llmConfigId: "c" } })), kind: "llm" as const };
    expect(applyAgentSubNodes(step)).toBe(step);
  });

  it("returns the same step when there are no sub-nodes", () => {
    const step = agentStep();
    expect(applyAgentSubNodes(step)).toBe(step);
  });

  it("folds a model sub-node into llmConfigId / agentModel / llmTier", () => {
    const step = agentStep(
      subNodes({ kind: "model", config: { llmConfigId: "cfg-1", model: "claude-opus", tier: "power" } }),
    );
    const next = applyAgentSubNodes(step);
    expect(next.llmConfigId).toBe("cfg-1");
    expect(next.agentModel).toBe("claude-opus");
    expect(next.llmTier).toBe("power");
    expect(next).not.toBe(step); // new object
  });

  it("ignores an invalid tier and missing model fields", () => {
    const next = applyAgentSubNodes(agentStep(subNodes({ kind: "model", config: { tier: "turbo" } })));
    expect(next.llmTier).toBeUndefined();
    expect(next.llmConfigId).toBeUndefined();
    expect(next.agentModel).toBeUndefined();
  });

  it("unions tool sub-nodes into agentSkills (dedup, existing first)", () => {
    const step = agentStep(
      subNodes(
        { kind: "tool", config: { skill: "slack" } },
        { kind: "tool", config: { tool: "gmail" } },
        { kind: "tool", config: { slug: "slack" } }, // dup
      ),
      { agentSkills: ["paperclip"] },
    );
    const next = applyAgentSubNodes(step);
    expect(next.agentSkills).toEqual(["paperclip", "slack", "gmail"]);
  });

  it("does not fold a memory sub-node (consumption tracked in HEL-818) but leaves it parseable", () => {
    const step = agentStep(subNodes({ kind: "memory", config: { type: "window", size: 10 } }));
    const next = applyAgentSubNodes(step);
    expect(next.agentModel).toBeUndefined();
    expect(next.llmConfigId).toBeUndefined();
    expect(next.agentSkills).toBeUndefined();
    // the memory sub-node still round-trips in config for the UI + future consumer
    expect(parseAgentSubNodes(next).find((s) => s.kind === "memory")?.config).toEqual({
      type: "window",
      size: 10,
    });
  });

  it("does not mutate the original step", () => {
    const step = agentStep(subNodes({ kind: "model", config: { llmConfigId: "cfg-1" } }), {
      agentSkills: ["paperclip"],
    });
    const snapshot = JSON.stringify(step);
    applyAgentSubNodes(step);
    expect(JSON.stringify(step)).toBe(snapshot);
  });
});
