import { renderWorkspaceInvite } from "./systemTemplates";
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
