import { consumeRateLimit, __resetRateLimitsForTests } from "./rateLimit";

describe("rateLimit", () => {
  beforeEach(() => __resetRateLimitsForTests());

  it("allows up to the bucket limit and rejects beyond it", () => {
    // refunds bucket is 5/day by default
    for (let i = 0; i < 5; i += 1) {
      consumeRateLimit("admin-1", "refunds");
    }
    expect(() => consumeRateLimit("admin-1", "refunds")).toThrow(/Rate limit exceeded/);
  });

  it("separates buckets per admin", () => {
    for (let i = 0; i < 5; i += 1) consumeRateLimit("admin-1", "refunds");
    // admin-2 still has full budget
    expect(() => consumeRateLimit("admin-2", "refunds")).not.toThrow();
  });

  it("uses env overrides when present", () => {
    process.env.ADMIN_RATE_LIMIT_REFUNDS = "2";
    try {
      consumeRateLimit("admin-3", "refunds");
      consumeRateLimit("admin-3", "refunds");
      expect(() => consumeRateLimit("admin-3", "refunds")).toThrow();
    } finally {
      delete process.env.ADMIN_RATE_LIMIT_REFUNDS;
    }
  });

  it("does not throw on unknown buckets but warns", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => consumeRateLimit("admin-1", "made_up_bucket")).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
