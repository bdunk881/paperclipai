import {
  buildRoleDetailPrompt,
  parseRoleDetailResponse,
  type RoleDetail,
} from "./roleDetail";
import type { TeamAssemblyRequest } from "./teamAssembly";
import type { TeamSkeleton } from "./teamSkeleton";

function detail(over: Partial<Record<keyof RoleDetail, unknown>> = {}): Record<string, unknown> {
  return {
    mandate: "Own X",
    justification: "Because Y",
    kpis: ["k1"],
    skills: ["s1"],
    tools: ["slack"],
    modelTier: "standard",
    budgetMonthlyUsd: null,
    provisioningInstructions: "Do Z on day one",
    ...over,
  };
}

const roster: Pick<TeamSkeleton, "roles"> = {
  roles: [
    { roleKey: "lead", title: "Lead", roleType: "executive", department: "exec", reportsToRoleKey: null },
    { roleKey: "op-1", title: "Operator 1", roleType: "operator", department: "ops", reportsToRoleKey: "lead" },
  ],
};

const request: TeamAssemblyRequest = {
  companyName: "Acme",
  normalizedGoalDocument: {
    sourceType: "free_text",
    goal: "Triage inbound support email and draft replies.",
    targetCustomer: null,
    successMetrics: ["faster response"],
    constraints: [],
    budget: null,
    timeHorizon: null,
    planReadinessThreshold: 0.5,
  },
  roleLibrary: [],
  connectedToolSlugs: [],
};

describe("roleDetail (HEL-551 / chunked generation PR3)", () => {
  describe("parseRoleDetailResponse", () => {
    it("returns detail for exactly the expected roleKeys", () => {
      const raw = JSON.stringify({ lead: detail(), "op-1": detail() });
      const out = parseRoleDetailResponse(raw, ["lead", "op-1"]);
      expect(Object.keys(out).sort()).toEqual(["lead", "op-1"]);
      expect(out["lead"].mandate).toBe("Own X");
    });

    it("drops extra (hallucinated) roleKeys not in the batch", () => {
      const raw = JSON.stringify({ lead: detail(), ghost: detail() });
      const out = parseRoleDetailResponse(raw, ["lead"]);
      expect(Object.keys(out)).toEqual(["lead"]);
    });

    it("throws when an expected roleKey is missing (for the orchestrator's retry)", () => {
      const raw = JSON.stringify({ lead: detail() });
      expect(() => parseRoleDetailResponse(raw, ["lead", "op-1"])).toThrow(
        /missing roleKeys: op-1/,
      );
    });

    it("coerces a non-numeric budget to null instead of failing the batch", () => {
      const raw = JSON.stringify({ lead: detail({ budgetMonthlyUsd: "$500/mo" }) });
      const out = parseRoleDetailResponse(raw, ["lead"]);
      expect(out["lead"].budgetMonthlyUsd).toBeNull();
    });

    it("coerces an out-of-enum modelTier to standard", () => {
      const raw = JSON.stringify({ lead: detail({ modelTier: "premium" }) });
      const out = parseRoleDetailResponse(raw, ["lead"]);
      expect(out["lead"].modelTier).toBe("standard");
    });

    it("throws when a genuinely required field is missing (e.g. kpis)", () => {
      const bad = detail();
      delete bad.kpis;
      const raw = JSON.stringify({ lead: bad });
      expect(() => parseRoleDetailResponse(raw, ["lead"])).toThrow(/role-detail/);
    });

    it("recovers from trailing content via the shared extractor", () => {
      const raw = JSON.stringify({ lead: detail() }) + "\n\nHope that helps!";
      const out = parseRoleDetailResponse(raw, ["lead"]);
      expect(out["lead"]).toBeDefined();
    });

    it("unwraps Anthropic's forced-tool {\"input\": {...}} envelope (HEL-648)", () => {
      // Opus 4.8 nests the whole record under the tool's "input" field when the
      // open-key record schema gives it no named keys to anchor to. Bare records
      // (gemini/openai) have roleKey slugs at top level and are untouched.
      const raw = JSON.stringify({ input: { lead: detail(), "op-1": detail() } });
      const out = parseRoleDetailResponse(raw, ["lead", "op-1"]);
      expect(Object.keys(out).sort()).toEqual(["lead", "op-1"]);
      expect(out["lead"].mandate).toBe("Own X");
    });

    it("still coerces fragile fields after unwrapping the envelope (HEL-648)", () => {
      const raw = JSON.stringify({
        input: { lead: detail({ budgetMonthlyUsd: "$500/mo", modelTier: "premium" }) },
      });
      const out = parseRoleDetailResponse(raw, ["lead"]);
      expect(out["lead"].budgetMonthlyUsd).toBeNull();
      expect(out["lead"].modelTier).toBe("standard");
    });
  });

  describe("buildRoleDetailPrompt", () => {
    it("lists the batch roleKeys and embeds the goal + roster", () => {
      const prompt = buildRoleDetailPrompt(request, roster, ["op-1"]);
      expect(prompt).toContain("Roles to detail in THIS response: op-1");
      expect(prompt).toContain("Triage inbound support email");
      expect(prompt).toContain("op-1 (Operator 1, operator");
      expect(prompt).toMatch(/Return JSON only/i);
    });
  });
});
