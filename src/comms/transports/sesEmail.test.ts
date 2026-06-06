import { SesEmailTransport, type SesEmailSendArgs } from "./sesEmail";
import type { ManagedEmailDecision } from "../customerEmailPolicy";
import { TransportError, type TransportMessage } from "../types";

const FROM = "AutoFlow <hello@via.helloautoflow.com>";
const message: TransportMessage = {
  to: "lead@example.com",
  subject: "Hi",
  html: "<p>Hi</p>",
  text: "Hi",
  workspaceId: "ws-1",
};

function transportWith(decision: ManagedEmailDecision, sends: SesEmailSendArgs[]) {
  return new SesEmailTransport({
    from: FROM,
    evaluate: async () => decision,
    sendEmail: async (args) => {
      sends.push(args);
      return { messageId: "ses-msg-1" };
    },
  });
}

describe("SesEmailTransport (HEL-615)", () => {
  it("sends on an opt-in decision with the resolved config set + workspace tag", async () => {
    const sends: SesEmailSendArgs[] = [];
    const t = transportWith({ action: "send", segment: "smb", configurationSet: "via-smb" }, sends);
    const result = await t.send(message);
    expect(result.providerMessageId).toBe("ses-msg-1");
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      to: "lead@example.com",
      from: FROM,
      subject: "Hi",
      configurationSet: "via-smb",
      workspaceId: "ws-1",
    });
  });

  it("returns suppressed (no send) on a suppressed decision", async () => {
    const sends: SesEmailSendArgs[] = [];
    const t = transportWith({ action: "suppressed", reason: "managed_email_opt_out" }, sends);
    const result = await t.send(message);
    expect(result).toEqual({ suppressed: true, suppressedReason: "managed_email_opt_out" });
    expect(sends).toHaveLength(0);
  });

  it("throws (non-retryable) when workspaceId is missing", async () => {
    const t = transportWith({ action: "send", segment: "smb", configurationSet: undefined }, []);
    await expect(t.send({ to: "x@y.com" })).rejects.toBeInstanceOf(TransportError);
  });

  it("throws when no From identity is configured", async () => {
    delete process.env.AUTOFLOW_CUSTOMER_EMAIL_FROM;
    const sends: SesEmailSendArgs[] = [];
    const t = new SesEmailTransport({
      from: undefined,
      evaluate: async () => ({ action: "send", segment: "smb", configurationSet: undefined }),
      sendEmail: async (a) => {
        sends.push(a);
        return {};
      },
    });
    await expect(t.send(message)).rejects.toThrow(/AUTOFLOW_CUSTOMER_EMAIL_FROM/);
    expect(sends).toHaveLength(0);
  });

  it("propagates a TransportError from the SES send (retry classification intact)", async () => {
    const t = new SesEmailTransport({
      from: FROM,
      evaluate: async () => ({ action: "send", segment: "sme", configurationSet: "via-sme" }),
      sendEmail: async () => {
        throw new TransportError("SES 500", { status: 500 });
      },
    });
    await expect(t.send(message)).rejects.toMatchObject({ retryable: true, status: 500 });
  });
});
