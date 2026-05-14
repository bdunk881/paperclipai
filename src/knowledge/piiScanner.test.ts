import { scanForPii } from "./piiScanner";

describe("scanForPii (HEL-88)", () => {
  it("returns null for clean content", () => {
    expect(scanForPii("Acme prefers Tuesday meetings. Marina is the buyer.")).toBeNull();
  });

  it("detects an SSN", () => {
    expect(scanForPii("Their SSN is 123-45-6789, just FYI.")?.kind).toBe("ssn");
  });

  it("detects a Luhn-valid credit card number", () => {
    // 4242 4242 4242 4242 is the Stripe test card and passes Luhn
    expect(scanForPii("Charge 4242 4242 4242 4242 today.")?.kind).toBe("credit_card");
  });

  it("ignores Luhn-invalid numeric sequences (e.g., phone numbers, IDs)", () => {
    // 16-digit number that fails Luhn
    expect(scanForPii("Order #1234567890123456 shipped today.")).toBeNull();
  });

  it("detects OpenAI-style API keys", () => {
    expect(scanForPii("Use sk-proj-abcdefghijklmnopqrstuvwxyz0123456789 to authenticate.")?.kind).toBe(
      "api_key",
    );
  });

  it("detects Anthropic-style API keys", () => {
    expect(scanForPii("Token: sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789")?.kind).toBe("api_key");
  });

  it("detects GitHub personal access tokens", () => {
    expect(scanForPii("Use ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 to clone.")?.kind).toBe("api_key");
  });

  it("detects JWTs", () => {
    expect(
      scanForPii(
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      )?.kind,
    ).toBe("jwt");
  });

  it("detects AWS access key IDs", () => {
    expect(scanForPii("Configured AKIAIOSFODNN7EXAMPLE as the prod key.")?.kind).toBe("aws_access_key");
  });

  it("returns null for legitimate prose that resembles patterns but isn't", () => {
    expect(
      scanForPii("Send the report to the team by Friday end-of-day. Marina will review."),
    ).toBeNull();
  });
});
