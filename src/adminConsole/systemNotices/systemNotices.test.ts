import {
  renderSystemStatusNotice,
  coerceNoticeKind,
  unsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  sendSystemNotice,
  type SystemNoticeRecipient,
} from "./systemNotices";
import { hasTemplate } from "../../mailer/templates";
import type { Mailer, MailerSendInput, MailerSendResult } from "../../mailer/types";

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

describe("system-status-notice template (HEL-366)", () => {
  it("self-registers on import", () => {
    expect(hasTemplate("system-status-notice")).toBe(true);
  });

  it("coerceNoticeKind defaults anything unknown to maintenance", () => {
    expect(coerceNoticeKind("incident")).toBe("incident");
    expect(coerceNoticeKind("resolution")).toBe("resolution");
    expect(coerceNoticeKind("maintenance")).toBe("maintenance");
    expect(coerceNoticeKind("garbage")).toBe("maintenance");
    expect(coerceNoticeKind(undefined)).toBe("maintenance");
  });

  it("renders header, title, window, impact, status + unsubscribe links", () => {
    const r = renderSystemStatusNotice({
      kind: "incident",
      title: "API latency",
      message: "We are investigating elevated latency.",
      windowStart: "2026-06-12 02:00 UTC",
      windowEnd: "2026-06-12 03:00 UTC",
      impact: "Slower API responses",
      statusPageUrl: "https://status.example",
      unsubscribeUrl: "https://api.example/api/system-notices/unsubscribe?email=a&token=b",
    });
    expect(r.subject).toContain("Service incident");
    expect(r.subject).toContain("API latency");
    expect(r.html).toContain("API latency");
    expect(r.html).toContain("Slower API responses");
    expect(r.html).toContain("2026-06-12 02:00 UTC – 2026-06-12 03:00 UTC");
    expect(r.html).toContain("https://status.example");
    expect(r.html).toContain("https://api.example/api/system-notices/unsubscribe");
    // text body is unescaped, so the apostrophe survives there
    expect(r.text).toContain("We are investigating elevated latency.");
  });

  it("degrades gracefully when only the message is present", () => {
    const r = renderSystemStatusNotice({ message: "Heads up." });
    expect(r.subject).toContain("Scheduled maintenance");
    expect(r.html).toContain("Heads up.");
    expect(r.html).not.toContain("When:");
    expect(r.html).not.toContain("Expected impact:");
    expect(r.html).not.toContain("<a href");
  });
});

describe("unsubscribe token (HEL-366)", () => {
  it("verifies a matching token (case-insensitive email) and rejects bad ones", () => {
    const token = unsubscribeToken("User@Example.com");
    expect(verifyUnsubscribeToken("user@example.com", token)).toBe(true);
    expect(verifyUnsubscribeToken("user@example.com", "deadbeef")).toBe(false);
    expect(verifyUnsubscribeToken("someone-else@example.com", token)).toBe(false);
  });

  it("buildUnsubscribeUrl returns a token URL, or null without a base", () => {
    expect(buildUnsubscribeUrl(null, "a@b.com")).toBeNull();
    const url = buildUnsubscribeUrl("https://api.example/", "a@b.com");
    expect(url).toContain("https://api.example/api/system-notices/unsubscribe?");
    expect(url).toContain("email=a%40b.com");
    expect(url).toContain("token=");
  });
});

describe("sendSystemNotice (HEL-366)", () => {
  const recipients: SystemNoticeRecipient[] = [
    { email: "a@example.com", workspaceId: "ws-a", userId: "u-a" },
    { email: "b@example.com", workspaceId: "ws-b", userId: "u-b" },
    { email: "c@example.com", workspaceId: null, userId: "u-c" },
  ];
  const notice = { kind: "maintenance" as const, title: "T", message: "M" };

  it("sends per-recipient and counts sent / suppressed / failed", async () => {
    const { mailer, calls } = fakeMailer(async (i) => {
      if (i.to === "b@example.com") return { suppressed: true };
      if (i.to === "c@example.com") throw new Error("boom");
      return { providerMessageId: "m1" };
    });

    const result = await sendSystemNotice(notice, recipients, {
      mailer,
      isOptedOut: async () => false,
      buildUnsubscribeUrl: (email) => `https://x/unsub?email=${email}`,
    });

    expect(result).toEqual({ targeted: 3, sent: 1, suppressed: 1, optedOut: 0, failed: 1 });
    // one send per recipient, each addressed individually (not visible to others)
    expect(calls.map((c) => c.to)).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
    expect(calls[0]).toMatchObject({ template: "system-status-notice", workspaceId: "ws-a" });
    expect(calls[0].data).toMatchObject({
      unsubscribeUrl: "https://x/unsub?email=a@example.com",
    });
  });

  it("skips opted-out recipients without calling the mailer", async () => {
    const { mailer, calls } = fakeMailer(async () => ({ providerMessageId: "m" }));

    const result = await sendSystemNotice(notice, recipients, {
      mailer,
      isOptedOut: async (email) => email === "a@example.com",
    });

    expect(result.optedOut).toBe(1);
    expect(result.sent).toBe(2);
    expect(calls.map((c) => c.to)).toEqual(["b@example.com", "c@example.com"]);
  });
});
