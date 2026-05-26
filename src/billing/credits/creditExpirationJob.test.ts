import { runCreditExpirationCycle } from "./creditExpirationJob";

describe("creditExpirationJob (in-memory mode no-op)", () => {
  it("returns a zero-counter result when DATABASE_URL is unconfigured", async () => {
    const result = await runCreditExpirationCycle();
    expect(result).toEqual({
      walletsScanned: 0,
      walletsExpired: 0,
      creditsExpired: 0n,
    });
  });
});
