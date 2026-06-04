import { afterEach, describe, expect, it } from "@jest/globals";

import {
  buildDefaultMfaEmailSender,
  LoggingMfaEmailSender,
  ResendMfaEmailSender,
  SendGridMfaEmailSender,
} from "./mfaEmailSender";

// HEL-404: AutoFlow's canonical transactional provider is Resend. The factory
// must prefer Resend, fall back to SendGrid, then the dev logging sender.
describe("buildDefaultMfaEmailSender — transport selection (HEL-404)", () => {
  const saved = {
    resend: process.env.RESEND_API_KEY,
    sendgrid: process.env.SENDGRID_API_KEY,
  };

  afterEach(() => {
    if (saved.resend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved.resend;
    if (saved.sendgrid === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = saved.sendgrid;
  });

  it("prefers Resend when RESEND_API_KEY is set (even if SendGrid is also set)", () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.SENDGRID_API_KEY = "SG.test";
    expect(buildDefaultMfaEmailSender()).toBeInstanceOf(ResendMfaEmailSender);
  });

  it("falls back to SendGrid when only SENDGRID_API_KEY is set", () => {
    delete process.env.RESEND_API_KEY;
    process.env.SENDGRID_API_KEY = "SG.test";
    expect(buildDefaultMfaEmailSender()).toBeInstanceOf(SendGridMfaEmailSender);
  });

  it("falls back to the dev logging sender when neither key is set", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SENDGRID_API_KEY;
    expect(buildDefaultMfaEmailSender()).toBeInstanceOf(LoggingMfaEmailSender);
  });
});
