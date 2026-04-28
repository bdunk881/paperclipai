import { approvalPolicyStore } from "./policyStore";

describe("approvalPolicyStore", () => {
  beforeEach(() => {
    void approvalPolicyStore.clear();
  });

  it("creates conservative defaults for every governed action type", async () => {
    const policies = await approvalPolicyStore.ensureDefaults(
      "11111111-1111-4111-8111-111111111111",
    );

    expect(policies).toHaveLength(5);
    expect(policies.every((policy) => policy.mode === "require_approval")).toBe(true);
    expect(
      policies.find((policy) => policy.actionType === "spend_above_threshold")
        ?.spendThresholdCents,
    ).toBe(0);
  });

  it("upserts a workspace-specific override", async () => {
    const policy = await approvalPolicyStore.upsert({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      actionType: "public_posts",
      mode: "notify_only",
    });

    expect(policy.mode).toBe("notify_only");

    const fetched = await approvalPolicyStore.get(
      "11111111-1111-4111-8111-111111111111",
      "public_posts",
    );
    expect(fetched?.mode).toBe("notify_only");
  });
});
