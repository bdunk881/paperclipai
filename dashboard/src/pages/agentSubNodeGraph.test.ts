import { describe, expect, it } from "vitest";
import {
  readAgentSubNodes,
  addAgentSubNode,
  updateAgentSubNode,
  removeAgentSubNode,
  projectAgentSubNodes,
  subNodeElementId,
} from "./agentSubNodeGraph";
import type { WorkflowStep } from "../types/workflow";

function agent(config?: Record<string, unknown>): WorkflowStep {
  return {
    id: "a1",
    name: "Agent",
    kind: "agent",
    description: "",
    inputKeys: [],
    outputKeys: [],
    ...(config ? { config } : {}),
  };
}

const withSubs = (subNodes: unknown[]): WorkflowStep => agent({ subNodes });

describe("readAgentSubNodes", () => {
  it("reads valid entries, skips malformed/unknown", () => {
    const step = withSubs([
      { id: "m", kind: "model", config: { llmConfigId: "c" } },
      { kind: "tool", config: { skill: "slack" } },
      { kind: "bogus" },
      "x",
    ]);
    const subs = readAgentSubNodes(step);
    expect(subs.map((s) => s.kind)).toEqual(["model", "tool"]);
    expect(subs[0]!.id).toBe("m");
    expect(subs[1]!.id).toBe("tool-1");
  });

  it("returns [] when absent", () => {
    expect(readAgentSubNodes(agent())).toEqual([]);
  });
});

describe("add / update / remove", () => {
  it("adds a tool (repeatable) and a model (singular)", () => {
    let subs = addAgentSubNode(agent(), "tool");
    expect(subs).toHaveLength(1);
    subs = addAgentSubNode(withSubs(subs), "tool");
    expect(subs).toHaveLength(2); // tool repeatable
    subs = addAgentSubNode(withSubs(subs), "model");
    expect(subs.filter((s) => s.kind === "model")).toHaveLength(1);
  });

  it("refuses a second model / memory", () => {
    const subs = addAgentSubNode(withSubs([{ id: "m", kind: "model", config: {} }]), "model");
    expect(subs.filter((s) => s.kind === "model")).toHaveLength(1);
    const mem = addAgentSubNode(withSubs([{ id: "x", kind: "memory", config: {} }]), "memory");
    expect(mem.filter((s) => s.kind === "memory")).toHaveLength(1);
  });

  it("updates a sub-node config (shallow merge) and removes by id", () => {
    const start = withSubs([{ id: "m", kind: "model", config: { llmConfigId: "c" } }]);
    const updated = updateAgentSubNode(start, "m", { tier: "power" });
    expect(updated[0]!.config).toEqual({ llmConfigId: "c", tier: "power" });
    expect(removeAgentSubNode(withSubs(updated), "m")).toEqual([]);
  });
});

describe("projectAgentSubNodes", () => {
  const posOf = () => ({ x: 100, y: 100 });

  it("projects nodes + attachment edges for agent sub-nodes only", () => {
    const steps: WorkflowStep[] = [
      withSubs([
        { id: "m", kind: "model", config: {} },
        { id: "t", kind: "tool", config: {} },
      ]),
      { ...agent(), id: "llm1", kind: "llm" }, // non-agent ignored
    ];
    const { nodes, edges } = projectAgentSubNodes(steps, posOf);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.id).toBe(subNodeElementId("a1", "m"));
    expect(edges).toHaveLength(2);
    expect(edges[0]!).toMatchObject({
      source: "a1",
      sourceHandle: "port:model",
      target: subNodeElementId("a1", "m"),
    });
  });

  it("honors an explicit uiPosition, else auto-places beneath the agent", () => {
    const steps = [
      withSubs([
        { id: "m", kind: "model", config: {}, uiPosition: { x: 5, y: 6 } },
        { id: "t", kind: "tool", config: {} },
      ]),
    ];
    const { nodes } = projectAgentSubNodes(steps, () => ({ x: 0, y: 0 }));
    expect(nodes[0]!.position).toEqual({ x: 5, y: 6 }); // explicit
    expect(nodes[1]!.position.y).toBe(200); // auto: base.y + drop
  });

  it("returns empty for steps without sub-nodes", () => {
    expect(projectAgentSubNodes([agent()], posOf)).toEqual({ nodes: [], edges: [] });
  });
});
