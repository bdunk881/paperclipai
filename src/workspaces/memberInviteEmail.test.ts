import { sendWorkspaceInviteEmail } from "./memberInviteRoutes";
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

const base = {
  email: "u@example.com",
  inviteUrl: "https://app.helloautoflow.com/auth/accept-invite?token=t",
  role: "operator",
  expiresAt: "2026-06-12T00:00:00Z",
  workspaceId: "11111111-1111-1111-1111-111111111111",
};

describe("sendWorkspaceInviteEmail", () => {
  it("returns 'sent' and calls sendTemplate with the workspace-invite data", async () => {
    const { mailer, calls } = fakeMailer(async () => ({ providerMessageId: "m1" }));
    expect(await sendWorkspaceInviteEmail(mailer, base)).toBe("sent");
    expect(calls[0]).toMatchObject({
      template: "workspace-invite",
      to: "u@example.com",
      workspaceId: base.workspaceId,
    });
    expect(calls[0].data).toMatchObject({ inviteLink: base.inviteUrl, role: "operator" });
  });

  it("returns 'suppressed' when the recipient is suppressed", async () => {
    const { mailer } = fakeMailer(async () => ({ suppressed: true }));
    expect(await sendWorkspaceInviteEmail(mailer, base)).toBe("suppressed");
  });

  it("returns 'logged' when the mailer neither sends nor suppresses (dev fallback)", async () => {
    const { mailer } = fakeMailer(async () => ({}));
    expect(await sendWorkspaceInviteEmail(mailer, base)).toBe("logged");
  });

  it("returns 'failed' (never throws) when the mailer throws", async () => {
    const { mailer } = fakeMailer(async () => {
      throw new Error("smtp down");
    });
    expect(await sendWorkspaceInviteEmail(mailer, base)).toBe("failed");
  });
});
