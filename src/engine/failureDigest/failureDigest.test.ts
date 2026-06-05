import {
  renderWorkflowFailureDigest,
  runFailureDigestCycle,
  type FailedRun,
  type FailureDigestDeps,
} from "./failureDigest";
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

describe("workflow-failure-digest template (HEL-365)", () => {
  it("self-registers on import", () => {
    expect(hasTemplate("workflow-failure-digest")).toBe(true);
  });

  it("renders count, names, errors, and run links", () => {
    const r = renderWorkflowFailureDigest({
      periodLabel: "the last 24 hours",
      failures: [
        {
          runId: "r1",
          workflowName: "Lead Enrichment",
          error: "Timeout calling provider",
          failedAt: "2026-06-05T01:00:00.000Z",
          url: "https://app.example/runs/r1",
        },
        {
          runId: "r2",
          workflowName: "Invoice Sync",
          error: "401 from Stripe",
          failedAt: "2026-06-05T02:00:00.000Z",
          url: "https://app.example/runs/r2",
        },
      ],
    });
    expect(r.subject).toContain("2 failed workflow runs");
    expect(r.html).toContain("Lead Enrichment");
    expect(r.html).toContain("Invoice Sync");
    expect(r.html).toContain("https://app.example/runs/r1");
    expect(r.text).toContain("401 from Stripe");
  });

  it("uses the singular noun for a single failure", () => {
    const r = renderWorkflowFailureDigest({
      failures: [{ runId: "r1", workflowName: "X", error: null, failedAt: null }],
    });
    expect(r.subject).toContain("1 failed workflow run");
  });
});

describe("runFailureDigestCycle (HEL-365)", () => {
  const failures: FailedRun[] = [
    { runId: "r1", workflowName: "X", error: "boom", failedAt: "2026-06-05T00:00:00.000Z" },
  ];

  function deps(over: Partial<FailureDigestDeps>): FailureDigestDeps {
    return {
      fetchFailuresByWorkspace: async () => new Map([["ws-1", failures]]),
      resolveRecipientEmail: async () => "owner@example.com",
      isOptedOut: async () => false,
      mailer: { sendTemplate: async () => ({ providerMessageId: "m" }) },
      buildRunUrl: (id: string) => `https://app.example/runs/${id}`,
      ...over,
    };
  }

  it("sends a digest to a workspace with failures (and injects run URLs)", async () => {
    const fm = fakeMailer(async () => ({ providerMessageId: "m" }));
    const result = await runFailureDigestCycle(deps({ mailer: fm.mailer }));

    expect(result.workspacesWithFailures).toBe(1);
    expect(result.notified).toBe(1);
    expect(fm.calls).toHaveLength(1);
    expect(fm.calls[0]).toMatchObject({
      template: "workflow-failure-digest",
      to: "owner@example.com",
      workspaceId: "ws-1",
    });
    const data = fm.calls[0].data as { failures: FailedRun[] };
    expect(data.failures[0].url).toBe("https://app.example/runs/r1");
  });

  it("skips opted-out workspaces without sending", async () => {
    const fm = fakeMailer(async () => ({ providerMessageId: "m" }));
    const result = await runFailureDigestCycle(deps({ mailer: fm.mailer, isOptedOut: async () => true }));
    expect(result.skippedOptedOut).toBe(1);
    expect(result.notified).toBe(0);
    expect(fm.calls).toHaveLength(0);
  });

  it("skips workspaces with no resolvable recipient", async () => {
    const fm = fakeMailer(async () => ({ providerMessageId: "m" }));
    const result = await runFailureDigestCycle(
      deps({ mailer: fm.mailer, resolveRecipientEmail: async () => null }),
    );
    expect(result.skippedNoRecipient).toBe(1);
    expect(fm.calls).toHaveLength(0);
  });

  it("sends nothing when there are no failures (no empty digests)", async () => {
    const fm = fakeMailer(async () => ({ providerMessageId: "m" }));
    const result = await runFailureDigestCycle(
      deps({ mailer: fm.mailer, fetchFailuresByWorkspace: async () => new Map() }),
    );
    expect(result).toMatchObject({ workspacesWithFailures: 0, notified: 0 });
    expect(fm.calls).toHaveLength(0);
  });

  it("counts suppressed sends separately from delivered", async () => {
    const fm = fakeMailer(async () => ({ suppressed: true }));
    const result = await runFailureDigestCycle(deps({ mailer: fm.mailer }));
    expect(result.suppressed).toBe(1);
    expect(result.notified).toBe(0);
  });
});
