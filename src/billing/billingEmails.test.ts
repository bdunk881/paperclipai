import {
  renderBillingReceipt,
  renderBillingPaymentFailed,
  sendBillingReceiptEmail,
  sendBillingPaymentFailedEmail,
} from "./billingEmails";
import { hasTemplate, renderTemplate } from "../mailer/templates";
import type { Mailer, MailerSendInput, MailerSendResult } from "../mailer/types";

function fakeMailer(impl: (i: MailerSendInput) => Promise<MailerSendResult>): {
  mailer: Mailer;
  calls: MailerSendInput[];
} {
  const calls: MailerSendInput[] = [];
  return {
    mailer: {
      sendTemplate: (i) => {
        calls.push(i);
        return impl(i);
      },
    },
    calls,
  };
}

describe("billing templates (HEL-363)", () => {
  it("self-register on import", () => {
    expect(hasTemplate("billing-receipt")).toBe(true);
    expect(hasTemplate("billing-payment-failed")).toBe(true);
  });

  it("billing-receipt renders amount, plan, invoice, period, and links", () => {
    const r = renderBillingReceipt({
      planName: "Flow",
      amount: "$19.00",
      invoiceNumber: "INV-001",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      invoiceUrl: "https://stripe.example/invoice",
      invoicePdf: "https://stripe.example/invoice.pdf",
    });
    expect(r.subject).toContain("INV-001");
    expect(r.html).toContain("$19.00");
    expect(r.html).toContain("Flow plan");
    expect(r.html).toContain("2026-06-01 – 2026-06-30");
    expect(r.html).toContain("https://stripe.example/invoice");
    expect(r.text).toContain("Download PDF: https://stripe.example/invoice.pdf");
  });

  it("billing-receipt degrades when only amount is present", () => {
    const r = renderBillingReceipt({ amount: "$5.00" });
    expect(r.html).toContain("$5.00");
    expect(r.html).toContain("subscription");
    expect(r.html).not.toContain("Billing period");
    expect(r.html).not.toContain("<a href");
  });

  it("billing-payment-failed renders amount, attempt, retry date, and update link", () => {
    const r = renderBillingPaymentFailed({
      planName: "Automate",
      amount: "$49.00",
      attempt: "2",
      nextAttemptAt: "2026-06-12",
      updatePaymentUrl: "https://stripe.example/pay",
      billingUrl: "https://app.example/settings/billing",
    });
    expect(r.subject).toContain("payment failed");
    expect(r.html).toContain("$49.00 for your Automate plan");
    expect(r.html).toContain("Failed attempt:");
    expect(r.html).toContain("2026-06-12");
    expect(r.html).toContain("https://stripe.example/pay");
    expect(r.text).toContain("Manage billing: https://app.example/settings/billing");
  });

  it("renders both through the registry", () => {
    expect(renderTemplate("billing-receipt", { amount: "$1.00" }).html).toContain("$1.00");
    expect(renderTemplate("billing-payment-failed", {}).html).toContain("subscription");
  });
});

describe("sendBillingReceiptEmail (HEL-363)", () => {
  const args = { to: "user@example.com", workspaceId: "ws-1", amount: "$19.00", planName: "Flow" };

  it("returns 'sent' and passes template + workspace to the mailer", async () => {
    const { mailer, calls } = fakeMailer(async () => ({ providerMessageId: "m1" }));
    expect(await sendBillingReceiptEmail(args, mailer)).toBe("sent");
    expect(calls[0]).toMatchObject({
      template: "billing-receipt",
      to: "user@example.com",
      workspaceId: "ws-1",
    });
    expect(calls[0].data).toMatchObject({ amount: "$19.00", planName: "Flow" });
  });

  it("returns 'suppressed' when the recipient is suppressed", async () => {
    const { mailer } = fakeMailer(async () => ({ suppressed: true }));
    expect(await sendBillingReceiptEmail(args, mailer)).toBe("suppressed");
  });

  it("returns 'logged' when the mailer neither sends nor suppresses", async () => {
    const { mailer } = fakeMailer(async () => ({}));
    expect(await sendBillingReceiptEmail(args, mailer)).toBe("logged");
  });

  it("returns 'skipped' (no mailer call) when there's no recipient", async () => {
    const { mailer, calls } = fakeMailer(async () => ({ providerMessageId: "m1" }));
    expect(await sendBillingReceiptEmail({ ...args, to: null }, mailer)).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("returns 'failed' (never throws) when the mailer throws", async () => {
    const { mailer } = fakeMailer(async () => {
      throw new Error("ses down");
    });
    expect(await sendBillingReceiptEmail(args, mailer)).toBe("failed");
  });
});

describe("sendBillingPaymentFailedEmail (HEL-363)", () => {
  it("returns 'sent' and targets the billing-payment-failed template", async () => {
    const { mailer, calls } = fakeMailer(async () => ({ providerMessageId: "m1" }));
    const status = await sendBillingPaymentFailedEmail(
      { to: "user@example.com", workspaceId: "ws-1", amount: "$49.00", attempt: "2" },
      mailer,
    );
    expect(status).toBe("sent");
    expect(calls[0]).toMatchObject({
      template: "billing-payment-failed",
      to: "user@example.com",
      workspaceId: "ws-1",
    });
    expect(calls[0].data).toMatchObject({ amount: "$49.00", attempt: "2" });
  });

  it("returns 'skipped' when there's no recipient", async () => {
    const { mailer, calls } = fakeMailer(async () => ({ providerMessageId: "m1" }));
    expect(await sendBillingPaymentFailedEmail({ to: "", amount: "$1.00" }, mailer)).toBe("skipped");
    expect(calls).toHaveLength(0);
  });
});
