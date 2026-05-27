import { __resetForTests, runCreditAnomalyDetection } from "./creditAnomalyDetectorJob";

describe("creditAnomalyDetectorJob — in-memory mode no-op", () => {
  beforeEach(() => {
    __resetForTests();
  });

  it("returns a zero-counter result when DATABASE_URL is unconfigured", async () => {
    const stubFetch = jest.fn() as unknown as typeof fetch;
    const result = await runCreditAnomalyDetection({ fetchImpl: stubFetch });

    expect(result).toEqual({
      spikes: 0,
      stuckWorkspaces: 0,
      dailyPlatformSpendUsd: 0,
      alertsFired: 0,
      alertsSuppressed: 0,
    });
    expect(stubFetch).not.toHaveBeenCalled();
  });
});
