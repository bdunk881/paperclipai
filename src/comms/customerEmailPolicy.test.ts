import { evaluateManagedEmail } from "./customerEmailPolicy";
import { customerSegmentForPlan, defaultManagedEmailOptIn } from "../billing/entitlements";

describe("customer-email tier mappers (HEL-615)", () => {
  it("segments SMB (explore/flow) vs SME (automate/scale)", () => {
    expect(customerSegmentForPlan("explore")).toBe("smb");
    expect(customerSegmentForPlan("flow")).toBe("smb");
    expect(customerSegmentForPlan("automate")).toBe("sme");
    expect(customerSegmentForPlan("scale")).toBe("sme");
  });

  it("defaults SMB opt-in, SME opt-out (plan decision #2)", () => {
    expect(defaultManagedEmailOptIn("explore")).toBe(true);
    expect(defaultManagedEmailOptIn("flow")).toBe(true);
    expect(defaultManagedEmailOptIn("automate")).toBe(false);
    expect(defaultManagedEmailOptIn("scale")).toBe(false);
  });
});

describe("evaluateManagedEmail (HEL-615)", () => {
  const base = {
    isSuppressed: async () => false,
    getPlan: async () => "flow" as const,
    getOptInOverride: async () => null,
  };

  afterEach(() => {
    delete process.env.SES_CONFIGURATION_SET_SMB;
    delete process.env.SES_CONFIGURATION_SET_SME;
  });

  it("suppresses a suppressed recipient (before any opt-in check)", async () => {
    const d = await evaluateManagedEmail("ws", "a@b.com", {
      ...base,
      isSuppressed: async () => true,
    });
    expect(d).toEqual({ action: "suppressed", reason: "suppressed" });
  });

  it("sends for an SMB plan (default opt-in) with the SMB config set", async () => {
    process.env.SES_CONFIGURATION_SET_SMB = "via-smb";
    const d = await evaluateManagedEmail("ws", "a@b.com", base);
    expect(d).toEqual({ action: "send", segment: "smb", configurationSet: "via-smb" });
  });

  it("opts out an SME plan by default", async () => {
    const d = await evaluateManagedEmail("ws", "a@b.com", {
      ...base,
      getPlan: async () => "scale" as const,
    });
    expect(d).toEqual({ action: "suppressed", reason: "managed_email_opt_out" });
  });

  it("override forces opt-in even on an SME plan (SME config set)", async () => {
    process.env.SES_CONFIGURATION_SET_SME = "via-sme";
    const d = await evaluateManagedEmail("ws", "a@b.com", {
      ...base,
      getPlan: async () => "automate" as const,
      getOptInOverride: async () => true,
    });
    expect(d).toEqual({ action: "send", segment: "sme", configurationSet: "via-sme" });
  });

  it("override forces opt-out even on an SMB plan", async () => {
    const d = await evaluateManagedEmail("ws", "a@b.com", {
      ...base,
      getOptInOverride: async () => false,
    });
    expect(d).toEqual({ action: "suppressed", reason: "managed_email_opt_out" });
  });
});
