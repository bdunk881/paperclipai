import { describe, it, expect } from "vitest";
import { buildSegments } from "./Connections";
import type { ConnectorHealthRecord } from "../api/client";
import type { CatalogIntegration } from "../api/integrationCatalogApi";

function live(connectorKey: string, connectorName: string): ConnectorHealthRecord {
  return {
    connectorKey,
    connectorName,
    state: "not_connected",
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    successRate24h: 0,
    authFailures15m: 0,
    rateLimitEvents15m: 0,
    transitions: [],
  } as ConnectorHealthRecord;
}

function cat(slug: string, name: string, category: string): CatalogIntegration {
  return {
    slug,
    name,
    description: `${name} desc`,
    category,
    icon: slug,
    authKind: "bearer",
    supportsOAuth: false,
    supportsApiKey: true,
    requiresInstanceDomain: false,
    actionCount: 0,
    triggerCount: 0,
    verified: true,
  };
}

describe("buildSegments", () => {
  it("groups live connectors under their respective segments", () => {
    const segments = buildSegments(
      [
        live("slack", "Slack"),
        live("gmail", "Gmail"),
        live("teams", "Microsoft Teams"),
        live("hubspot", "HubSpot"),
        live("apollo", "Apollo"),
        live("linear", "Linear"),
        live("sentry", "Sentry"),
        live("stripe", "Stripe"),
        live("composio", "Composio"),
      ],
      [],
    );
    const byLabel = Object.fromEntries(segments);

    expect(byLabel.Communication.live.map((c) => c.connectorName)).toEqual([
      "Gmail",
      "Microsoft Teams",
      "Slack",
    ]);
    expect(byLabel.CRM.live.map((c) => c.connectorKey)).toEqual(["hubspot"]);
    expect(byLabel.Sales.live.map((c) => c.connectorKey)).toEqual(["apollo"]);
    expect(byLabel["Developer Tools"].live.map((c) => c.connectorKey).sort()).toEqual([
      "linear",
      "sentry",
    ]);
    expect(byLabel.Finance.live.map((c) => c.connectorKey)).toEqual(["stripe"]);
    expect(byLabel.Automation.live.map((c) => c.connectorKey)).toEqual(["composio"]);
  });

  it("merges catalog entries into the same segments, live first", () => {
    const segments = buildSegments(
      [live("slack", "Slack")],
      [cat("sendgrid", "SendGrid", "communication"), cat("notion", "Notion", "productivity")],
    );
    const byLabel = Object.fromEntries(segments);

    // SendGrid joins Slack under Communication; live connectors precede catalog.
    expect(byLabel.Communication.live.map((c) => c.connectorName)).toEqual(["Slack"]);
    expect(byLabel.Communication.catalog.map((e) => e.name)).toEqual(["SendGrid"]);
    expect(byLabel.Productivity.catalog.map((e) => e.name)).toEqual(["Notion"]);
  });

  it("sorts segments alphabetically by label", () => {
    const labels = buildSegments(
      [live("stripe", "Stripe"), live("slack", "Slack")],
      [cat("zendesk", "Zendesk", "support")],
    ).map(([label]) => label);
    expect(labels).toEqual([...labels].sort());
  });
});
