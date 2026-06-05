import { SesMailer, LoggingMailer, isSesConfigured, SesSendArgs } from "./sesMailer";

const renderOk = () => ({ subject: "S", html: "<p>H</p>", text: "T" });
const FROM = "AutoFlow <noreply@mail.helloautoflow.com>";
const WS = "11111111-1111-1111-1111-111111111111";

describe("SesMailer", () => {
  it("sends via SES with a workspace_id tag and returns the provider message id", async () => {
    const calls: SesSendArgs[] = [];
    const mailer = new SesMailer({
      isSuppressed: async () => false,
      render: renderOk,
      sendEmail: async (a) => {
        calls.push(a);
        return { messageId: "ses-1" };
      },
      from: FROM,
    });

    const res = await mailer.sendTemplate({
      template: "workspace-invite",
      to: "user@example.com",
      data: { inviteLink: "https://x" },
      workspaceId: WS,
    });

    expect(res.providerMessageId).toBe("ses-1");
    expect(res.suppressed).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      from: FROM,
      to: "user@example.com",
      subject: "S",
      workspaceId: WS,
    });
  });

  it("fails closed (suppressed) without sending when the recipient is suppressed", async () => {
    let sent = 0;
    const mailer = new SesMailer({
      isSuppressed: async () => true,
      render: renderOk,
      sendEmail: async () => {
        sent += 1;
        return { messageId: "x" };
      },
      from: FROM,
    });

    const res = await mailer.sendTemplate({ template: "x", to: "b@example.com", data: {} });
    expect(res.suppressed).toBe(true);
    expect(res.providerMessageId).toBeUndefined();
    expect(sent).toBe(0);
  });

  it("checks GLOBAL suppression for a system send with no workspace", async () => {
    const scopes: string[] = [];
    const mailer = new SesMailer({
      isSuppressed: async (ws) => {
        scopes.push(ws);
        return false;
      },
      render: renderOk,
      sendEmail: async () => ({ messageId: "m" }),
      from: FROM,
    });
    await mailer.sendTemplate({ template: "x", to: "u@example.com", data: {} });
    expect(scopes[0]).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("throws when no From identity is configured", async () => {
    const prev = process.env.AUTOFLOW_SYSTEM_EMAIL_FROM;
    delete process.env.AUTOFLOW_SYSTEM_EMAIL_FROM;
    const mailer = new SesMailer({
      isSuppressed: async () => false,
      render: renderOk,
      sendEmail: async () => ({}),
    });
    await expect(
      mailer.sendTemplate({ template: "x", to: "u@example.com", data: {} }),
    ).rejects.toThrow(/AUTOFLOW_SYSTEM_EMAIL_FROM/);
    if (prev !== undefined) process.env.AUTOFLOW_SYSTEM_EMAIL_FROM = prev;
  });
});

describe("buildSystemMailer / isSesConfigured", () => {
  it("falls back to LoggingMailer when unconfigured", async () => {
    const prev = process.env.AUTOFLOW_SYSTEM_EMAIL_FROM;
    delete process.env.AUTOFLOW_SYSTEM_EMAIL_FROM;
    expect(isSesConfigured()).toBe(false);
    const mailer = new LoggingMailer();
    await expect(mailer.sendTemplate({ template: "x", to: "u@e.com", data: {} })).resolves.toEqual({});
    if (prev !== undefined) process.env.AUTOFLOW_SYSTEM_EMAIL_FROM = prev;
  });
});
