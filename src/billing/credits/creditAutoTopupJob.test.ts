import { __resetForTests, runCreditAutoTopupCycle } from "./creditAutoTopupJob";

describe("creditAutoTopupJob — in-memory mode no-op", () => {
  beforeEach(() => {
    __resetForTests();
  });

  it("returns zero-counter result when DATABASE_URL is unconfigured", async () => {
    const result = await runCreditAutoTopupCycle();
    expect(result).toEqual({ candidates: 0, charged: 0, skipped: 0, failed: 0 });
  });
});
