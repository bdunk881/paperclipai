import { createFinancialStatementReport, resolveWindow } from "./reportService";

describe("createFinancialStatementReport", () => {
  it("computes revenue, cash position, and burn metrics from stripe data", () => {
    const window = resolveWindow("2026-04-01T00:00:00.000Z", "2026-04-30T23:59:59.000Z");

    const report = createFinancialStatementReport({
      teamId: "team-1",
      window,
      invoices: [
        { id: "inv-paid", status: "paid", total: 12000, createdAt: "2026-04-03T12:00:00.000Z", livemode: false },
        { id: "inv-open", status: "open", total: 3000, createdAt: "2026-04-04T12:00:00.000Z", livemode: false },
      ],
      paymentIntents: [
        { id: "pi-1", status: "succeeded", amount: 9000, currency: "usd", createdAt: "2026-04-05T12:00:00.000Z", livemode: false },
        { id: "pi-2", status: "processing", amount: 1000, currency: "usd", createdAt: "2026-04-06T12:00:00.000Z", livemode: false },
      ],
      subscriptions: [
        { id: "sub-1", status: "active", cancelAtPeriodEnd: false, createdAt: "2026-04-01T00:00:00.000Z", livemode: false },
        { id: "sub-2", status: "canceled", cancelAtPeriodEnd: true, createdAt: "2026-04-01T00:00:00.000Z", livemode: false },
      ],
      openingCashMinor: 5000,
      operatingExpensesMinor: 11000,
      delivery: [],
      template: {},
    });

    expect(report.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "recognized_revenue_minor", value: 12000 }),
        expect.objectContaining({ key: "cash_collected_minor", value: 9000 }),
        expect.objectContaining({ key: "cash_position_minor", value: 3000 }),
        expect.objectContaining({ key: "burn_rate_minor", value: 2000 }),
        expect.objectContaining({ key: "active_subscriptions", value: 1 }),
      ])
    );
    expect(report.sections[0].body).toContain("Recognized revenue: 12000");
    expect(report.summary).toContain("Recognized revenue was 12000");
  });
});
