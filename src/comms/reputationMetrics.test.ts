import {
  mapReputationDbRow,
  toCommsReputationMetric,
  type RawReputationDbRow,
} from "./reputationMetrics";

describe("mapReputationDbRow (HEL-728)", () => {
  it("coerces pg bigint strings to numbers and normalizes last_send_at", () => {
    const raw: RawReputationDbRow = {
      workspace_id: "ws-1",
      workspace_name: "Acme",
      sends_total: "100",
      sent: "90",
      failed: "5",
      suppressed: "5",
      email_sent: "80",
      email_bounces: "2",
      email_complaints: "0",
      last_send_at: new Date("2026-06-05T00:00:00.000Z"),
    };
    const row = mapReputationDbRow(raw);
    expect(row.sendsTotal).toBe(100);
    expect(row.emailBounces).toBe(2);
    expect(row.lastSendAt).toBe("2026-06-05T00:00:00.000Z");
  });

  it("maps a null last_send_at to null", () => {
    const row = mapReputationDbRow({
      workspace_id: "ws",
      workspace_name: "W",
      sends_total: 0,
      sent: 0,
      failed: 0,
      suppressed: 0,
      email_sent: 0,
      email_bounces: 0,
      email_complaints: 0,
      last_send_at: null,
    });
    expect(row.lastSendAt).toBeNull();
  });
});

describe("toCommsReputationMetric (HEL-728)", () => {
  const base = {
    workspaceId: "ws-1",
    workspaceName: "Acme",
    sendsTotal: 100,
    sent: 90,
    failed: 5,
    suppressed: 5,
    emailSent: 80,
    emailBounces: 0,
    emailComplaints: 0,
    lastSendAt: null,
  };

  it("computes delivery/failure/bounce/complaint rates", () => {
    const m = toCommsReputationMetric({ ...base, emailBounces: 4, emailComplaints: 0 });
    expect(m.deliveryRate).toBeCloseTo(0.9);
    expect(m.failureRate).toBeCloseTo(0.05);
    expect(m.bounceRate).toBeCloseTo(0.05); // 4 / 80
  });

  it("flags high_bounce above 5%", () => {
    const m = toCommsReputationMetric({ ...base, emailBounces: 5, emailSent: 80 }); // 6.25%
    expect(m.flags).toContain("high_bounce");
  });

  it("flags high_complaint above 0.1%", () => {
    const m = toCommsReputationMetric({ ...base, emailComplaints: 1, emailSent: 500 }); // 0.2%
    expect(m.flags).toContain("high_complaint");
  });

  it("no flags and zero rates when there are no email sends", () => {
    const m = toCommsReputationMetric({
      ...base,
      sendsTotal: 0,
      sent: 0,
      failed: 0,
      suppressed: 0,
      emailSent: 0,
    });
    expect(m.bounceRate).toBe(0);
    expect(m.complaintRate).toBe(0);
    expect(m.deliveryRate).toBe(0);
    expect(m.flags).toEqual([]);
  });
});
