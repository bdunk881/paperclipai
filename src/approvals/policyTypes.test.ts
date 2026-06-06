import {
  resolveApprovalTierActionType,
  composioTierFromSlug,
  COMPOSIO_EXECUTE_ACTION,
} from "./policyTypes";
import type { WorkflowStep } from "../types/workflow";

function step(partial: Partial<WorkflowStep>): WorkflowStep {
  return {
    id: "s1",
    name: "step",
    kind: "action",
    description: "",
    inputKeys: [],
    outputKeys: [],
    ...partial,
  } as WorkflowStep;
}

describe("composioTierFromSlug (HEL-754)", () => {
  it("maps high-risk write verbs to the matching tier", () => {
    expect(composioTierFromSlug("GMAIL_SEND_EMAIL")).toBe("customer_facing_comms");
    expect(composioTierFromSlug("SLACK_SEND_MESSAGE")).toBe("customer_facing_comms");
    expect(composioTierFromSlug("STRIPE_CREATE_PAYMENT_INTENT")).toBe("spend_above_threshold");
    expect(composioTierFromSlug("DOCUSIGN_SEND_ENVELOPE")).toBe("contracts");
    expect(composioTierFromSlug("GITHUB_MERGE_PULL_REQUEST")).toBe("code_merges_to_prod");
    expect(composioTierFromSlug("LINKEDIN_CREATE_POST")).toBe("public_posts");
  });

  it("never gates reads / lookups (even when the noun looks risky)", () => {
    expect(composioTierFromSlug("GMAIL_FETCH_EMAILS")).toBeUndefined();
    expect(composioTierFromSlug("GITHUB_GET_REPO")).toBeUndefined();
    expect(composioTierFromSlug("STRIPE_LIST_INVOICES")).toBeUndefined();
    expect(composioTierFromSlug("HUBSPOT_SEARCH_CONTACTS")).toBeUndefined();
  });

  it("leaves benign writes ungoverned", () => {
    expect(composioTierFromSlug("GITHUB_CREATE_ISSUE")).toBeUndefined();
    expect(composioTierFromSlug("NOTION_CREATE_PAGE")).toBeUndefined();
  });
});

describe("resolveApprovalTierActionType for composio.execute (HEL-754)", () => {
  it("derives the tier from step.config.slug", () => {
    expect(
      resolveApprovalTierActionType(
        step({ action: COMPOSIO_EXECUTE_ACTION, config: { toolkit: "gmail", slug: "GMAIL_SEND_EMAIL" } }),
      ),
    ).toBe("customer_facing_comms");
  });

  it("honors the `tool` config key as an alias for slug", () => {
    expect(
      resolveApprovalTierActionType(
        step({ action: COMPOSIO_EXECUTE_ACTION, config: { tool: "STRIPE_CREATE_REFUND" } }),
      ),
    ).toBe("spend_above_threshold");
  });

  it("an explicit governance.actionType overrides the slug heuristic", () => {
    expect(
      resolveApprovalTierActionType(
        step({
          action: COMPOSIO_EXECUTE_ACTION,
          config: { slug: "GMAIL_FETCH_EMAILS", governance: { actionType: "spend_above_threshold" } },
        }),
      ),
    ).toBe("spend_above_threshold");
  });

  it("is undefined for a composio.execute read with no override", () => {
    expect(
      resolveApprovalTierActionType(
        step({ action: COMPOSIO_EXECUTE_ACTION, config: { slug: "GMAIL_FETCH_EMAILS" } }),
      ),
    ).toBeUndefined();
  });

  it("is undefined when composio.execute has no slug", () => {
    expect(
      resolveApprovalTierActionType(step({ action: COMPOSIO_EXECUTE_ACTION, config: {} })),
    ).toBeUndefined();
  });

  it("still resolves native actions via the curated map", () => {
    expect(resolveApprovalTierActionType(step({ action: "content.publish" }))).toBe("public_posts");
    expect(resolveApprovalTierActionType(step({ action: "github.mergeToProd" }))).toBe(
      "code_merges_to_prod",
    );
    expect(resolveApprovalTierActionType(step({ action: "unknown.action" }))).toBeUndefined();
  });
});
