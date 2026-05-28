import { approvalPolicyStore } from "./policyStore";

const TEST_WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEST_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("approvalPolicyStore", () => {
  beforeEach(() => {
    void approvalPolicyStore.clear();
  });

  it("creates conservative defaults for every governed action type", async () => {
    const policies = await approvalPolicyStore.ensureDefaults(TEST_WORKSPACE_ID, TEST_USER_ID);

    expect(policies).toHaveLength(5);
    expect(policies.every((policy) => policy.mode === "require_approval")).toBe(true);
    // Default $500 spend threshold (DEFAULT_SPEND_THRESHOLD_CENTS in
    // policyTypes.ts) — was 0 historically but rendered as "Spend over
    // $0" in the dashboard, which is meaningless.
    expect(
      policies.find((policy) => policy.actionType === "spend_above_threshold")
        ?.spendThresholdCents,
    ).toBe(50_000);
  });

  it("upserts a workspace-specific override", async () => {
    const policy = await approvalPolicyStore.upsert({
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_USER_ID,
      actionType: "public_posts",
      mode: "notify_only",
    });

    expect(policy.mode).toBe("notify_only");

    const fetched = await approvalPolicyStore.get(
      TEST_WORKSPACE_ID,
      TEST_USER_ID,
      "public_posts",
    );
    expect(fetched?.mode).toBe("notify_only");
  });
});
