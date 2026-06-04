import { afterEach, describe, expect, it } from "@jest/globals";

import {
  buildDefaultMfaEmailSender,
  LoggingMfaEmailSender,
  ResendMfaEmailSender,
} from "./mfaEmailSender";

// HEL-404: AutoFlow's canonical transactional provider is Resend. The factory
// uses Resend when RESEND_API_KEY is set, else the dev logging fallback.
describe("buildDefaultMfaEmailSender — transport selection (HEL-404)", () => {
  const savedResend = process.env.RESEND_API_KEY;

  afterEach(() => {
    if (savedResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedResend;
  });

  it("uses Resend when RESEND_API_KEY is set", () => {
    process.env.RESEND_API_KEY = "re_test";
    expect(buildDefaultMfaEmailSender()).toBeInstanceOf(ResendMfaEmailSender);
  });

  it("falls back to the dev logging sender when RESEND_API_KEY is unset", () => {
    delete process.env.RESEND_API_KEY;
    expect(buildDefaultMfaEmailSender()).toBeInstanceOf(LoggingMfaEmailSender);
  });
});
