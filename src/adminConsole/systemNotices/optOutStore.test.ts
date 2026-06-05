import { systemNoticeOptOutStore } from "./optOutStore";

// jest.env.cjs sets NODE_ENV=test + AUTOFLOW_ALLOW_INMEMORY=true, so the store
// uses its in-memory mirror here.
describe("systemNoticeOptOutStore (HEL-366)", () => {
  beforeEach(async () => {
    await systemNoticeOptOutStore.clear();
  });

  it("opt-out is case-insensitive and idempotent", async () => {
    await systemNoticeOptOutStore.optOut("User@Example.com", "test");
    expect(await systemNoticeOptOutStore.isOptedOut("user@example.com")).toBe(true);
    expect(await systemNoticeOptOutStore.isOptedOut("USER@EXAMPLE.COM")).toBe(true);

    await systemNoticeOptOutStore.optOut("user@example.com"); // idempotent
    const list = await systemNoticeOptOutStore.list();
    expect(list).toHaveLength(1);
    expect(list[0].email).toBe("user@example.com");
  });

  it("returns false for a non-opted-out or blank email", async () => {
    expect(await systemNoticeOptOutStore.isOptedOut("nobody@example.com")).toBe(false);
    expect(await systemNoticeOptOutStore.isOptedOut("   ")).toBe(false);
  });
});
