import { approvalPolicyStore } from "./policyStore";

describe("approvalPolicyStore", () => {
  beforeEach(() => {
    void approvalPolicyStore.clear();
  });

  it("creates conservative defaults for every governed action type", async () => {
    const policies = await approvalPolicyStore.ensureDefaults(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actionType: "public_posts",
      mode: "notify_only",
    });

    expect(policy.mode).toBe("notify_only");

    const fetched = await approvalPolicyStore.get(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "public_posts",
    );
    expect(fetched?.mode).toBe("notify_only");
  });
});
