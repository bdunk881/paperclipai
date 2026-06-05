import { suppressionStore } from "./suppressionStore";

const WS_A = "11111111-1111-1111-1111-111111111111";
const WS_B = "22222222-2222-2222-2222-222222222222";

beforeEach(async () => {
  await suppressionStore.clear();
});

describe("suppressionStore", () => {
  it("reports not-suppressed by default", async () => {
    expect(await suppressionStore.isSuppressed(WS_A, "nobody@example.com")).toBe(false);
  });

  it("suppresses scoped to one workspace only", async () => {
    await suppressionStore.suppress({ workspaceId: WS_A, email: "bounce@example.com", reason: "bounce" });
    expect(await suppressionStore.isSuppressed(WS_A, "bounce@example.com")).toBe(true);
    expect(await suppressionStore.isSuppressed(WS_B, "bounce@example.com")).toBe(false);
  });

  it("applies a global suppression to every workspace", async () => {
    await suppressionStore.suppress({ workspaceId: null, email: "spamtrap@example.com", reason: "complaint" });
    expect(await suppressionStore.isSuppressed(WS_A, "spamtrap@example.com")).toBe(true);
    expect(await suppressionStore.isSuppressed(WS_B, "spamtrap@example.com")).toBe(true);
  });

  it("matches case-insensitively", async () => {
    await suppressionStore.suppress({ workspaceId: WS_A, email: "User@Example.com", reason: "manual" });
    expect(await suppressionStore.isSuppressed(WS_A, "user@example.com")).toBe(true);
  });

  it("is idempotent on (scope, email)", async () => {
    await suppressionStore.suppress({ workspaceId: WS_A, email: "dup@example.com", reason: "bounce" });
    await suppressionStore.suppress({ workspaceId: WS_A, email: "dup@example.com", reason: "bounce" });
    const list = await suppressionStore.list(WS_A);
    expect(list.filter((s) => s.email === "dup@example.com")).toHaveLength(1);
  });

  it("lists a workspace's own + global suppressions", async () => {
    await suppressionStore.suppress({ workspaceId: WS_A, email: "a@example.com", reason: "bounce" });
    await suppressionStore.suppress({ workspaceId: null, email: "global@example.com", reason: "complaint" });
    await suppressionStore.suppress({ workspaceId: WS_B, email: "b@example.com", reason: "bounce" });

    const list = await suppressionStore.list(WS_A);
    const emails = list.map((s) => s.email).sort();
    expect(emails).toEqual(["a@example.com", "global@example.com"]);
  });
});
