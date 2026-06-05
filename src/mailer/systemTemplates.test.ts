import { renderApprovalRequestOutOfBand, renderWorkspaceInvite } from "./systemTemplates";
import { hasTemplate, renderTemplate } from "./templates";

describe("workspace-invite template", () => {
  it("self-registers under 'workspace-invite' on import", () => {
    expect(hasTemplate("workspace-invite")).toBe(true);
  });

  it("renders subject/html/text with workspace, role, and invite link", () => {
    const r = renderWorkspaceInvite({
      workspaceName: "Acme",
      inviterName: "Sam",
      role: "admin",
      inviteLink: "https://app.helloautoflow.com/auth/accept-invite?token=abc",
      expiresAt: "2026-06-12",
    });
    expect(r.subject).toContain("Acme");
    expect(r.html).toContain("https://app.helloautoflow.com/auth/accept-invite?token=abc");
    expect(r.html).toContain("admin");
    expect(r.html).toContain("Sam");
    expect(r.text).toContain("https://app.helloautoflow.com/auth/accept-invite?token=abc");
  });

  it("degrades gracefully when optional fields are missing", () => {
    const r = renderWorkspaceInvite({ inviteLink: "https://x" });
    expect(r.subject).toContain("AutoFlow");
    expect(r.html).toContain("https://x");
    expect(r.html).not.toContain("expires on");
  });

  it("renders through the registry via renderTemplate()", () => {
    const r = renderTemplate("workspace-invite", { inviteLink: "https://y", role: "viewer" });
    expect(r.html).toContain("https://y");
    expect(r.html).toContain("viewer");
  });
});

describe("approval-request-out-of-band template (HEL-364)", () => {
  it("self-registers under 'approval-request-out-of-band' on import", () => {
    expect(hasTemplate("approval-request-out-of-band")).toBe(true);
  });

  it("renders the question, workflow/step context, expiry, and approve/deny/review links", () => {
    const r = renderApprovalRequestOutOfBand({
      workflowName: "Support Bot",
      stepName: "Manager Approval",
      message: "Refund $480 to the customer?",
      requestedAt: "2026-04-22T10:00:00.000Z",
      expiresAt: "2026-04-22T11:00:00.000Z",
      reviewUrl: "https://dashboard.example.com/approvals/approval-1",
      approveUrl: "https://dashboard.example.com/approvals/approval-1?decision=approve",
      denyUrl: "https://dashboard.example.com/approvals/approval-1?decision=reject",
    });
    expect(r.subject).toContain("Support Bot");
    expect(r.subject).toContain("Manager Approval");
    expect(r.html).toContain("Refund $480 to the customer?");
    expect(r.html).toContain("Manager Approval");
    expect(r.html).toContain("approval-1?decision=approve");
    expect(r.html).toContain("approval-1?decision=reject");
    expect(r.html).toContain(">Review in AutoFlow<");
    expect(r.text).toContain("Responds by: 2026-04-22T11:00:00.000Z");
    expect(r.text).toContain(
      "Approve: https://dashboard.example.com/approvals/approval-1?decision=approve",
    );
  });

  it("degrades gracefully when only the question is present", () => {
    const r = renderApprovalRequestOutOfBand({ message: "Approve this?" });
    expect(r.subject).toContain("a workflow");
    expect(r.html).toContain("Approve this?");
    expect(r.html).not.toContain("Responds by");
    expect(r.html).not.toContain("<a href");
  });

  it("renders through the registry via renderTemplate()", () => {
    const r = renderTemplate("approval-request-out-of-band", {
      workflowName: "Billing",
      message: "Send the invoice?",
    });
    expect(r.html).toContain("Send the invoice?");
    expect(r.html).toContain("Billing");
  });
});
