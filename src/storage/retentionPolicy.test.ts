import {
  buildLifecycleConfiguration,
  RETENTION_LIFECYCLE,
  ABORT_INCOMPLETE_MPU_DAYS,
  ABORT_MPU_RULE_ID,
  retentionRuleId,
} from "./retentionPolicy";

describe("retentionPolicy (HEL-358)", () => {
  it("maps the three retention classes to the ticket's TTLs", () => {
    expect(RETENTION_LIFECYCLE.short).toEqual({ expireAfterDays: 30, objectLock: false });
    expect(RETENTION_LIFECYCLE.standard).toEqual({ expireAfterDays: 365, objectLock: false });
    expect(RETENTION_LIFECYCLE.legal_hold).toEqual({ expireAfterDays: null, objectLock: true });
  });

  it("builds prefix expiration rules for short + standard, skips legal_hold, adds abort-MPU", () => {
    const { rules } = buildLifecycleConfiguration();
    const byId = new Map(rules.map((r) => [r.id, r]));

    expect(byId.get(retentionRuleId("short"))).toMatchObject({
      status: "Enabled",
      prefix: "short/",
      expirationDays: 30,
    });
    expect(byId.get(retentionRuleId("standard"))).toMatchObject({
      status: "Enabled",
      prefix: "standard/",
      expirationDays: 365,
    });
    // legal_hold must never auto-expire → no expiration rule emitted.
    expect(byId.has(retentionRuleId("legal_hold"))).toBe(false);

    expect(byId.get(ABORT_MPU_RULE_ID)).toMatchObject({
      status: "Enabled",
      abortIncompleteMultipartUploadDays: ABORT_INCOMPLETE_MPU_DAYS,
    });

    // short + standard + abort-MPU = 3 rules.
    expect(rules).toHaveLength(3);
  });

  it("emits stable, deterministic rule ids", () => {
    const a = buildLifecycleConfiguration().rules.map((r) => r.id);
    const b = buildLifecycleConfiguration().rules.map((r) => r.id);
    expect(a).toEqual(b);
    expect(a).toEqual(["retention-short", "retention-standard", "abort-incomplete-multipart-uploads"]);
  });
});
