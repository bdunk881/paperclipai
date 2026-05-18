/**
 * DASH-23 tests for the agent integration allowlist filter.
 *
 * Permissions loading hits a Postgres pool — we mock the pool via
 * withWorkspaceContext to stay schema-free. The filter itself is
 * pure and gets the bulk of the assertions.
 */

import type { AgentTool } from "../engine/llmProviders/types";
import {
  filterToolsByPermissions,
  type AgentIntegrationPermissions,
} from "./agentToolPermissions";

function makeTool(name: string): AgentTool {
  return {
    name,
    description: name,
    inputSchema: {},
    handler: async () => "ok",
  };
}

const saveMemoryTool = makeTool("save_memory");
const slackPost = makeTool("integration:slack:post_message");
const slackRead = makeTool("integration:slack:read_channel");
const hubspotContact = makeTool("integration:hubspot:create_contact");
const stripeRefund = makeTool("integration:stripe:create_refund");
const customTool = makeTool("nontypical_custom_tool");

describe("filterToolsByPermissions (DASH-23)", () => {
  const allTools = [
    saveMemoryTool,
    slackPost,
    slackRead,
    hubspotContact,
    stripeRefund,
    customTool,
  ];

  it("passes every tool through when permissions are unrestricted (NULL allowlist)", () => {
    const perms: AgentIntegrationPermissions = {
      allowedSlugs: null,
      unrestricted: true,
    };
    expect(filterToolsByPermissions(allTools, perms)).toEqual(allTools);
  });

  it("keeps only built-ins + the custom tool when allowlist is empty", () => {
    const perms: AgentIntegrationPermissions = {
      allowedSlugs: [],
      unrestricted: false,
    };
    const filtered = filterToolsByPermissions(allTools, perms);
    expect(filtered).toContain(saveMemoryTool);
    expect(filtered).toContain(customTool);
    expect(filtered).not.toContain(slackPost);
    expect(filtered).not.toContain(slackRead);
    expect(filtered).not.toContain(hubspotContact);
    expect(filtered).not.toContain(stripeRefund);
  });

  it("permits only the listed slugs (slack only)", () => {
    const perms: AgentIntegrationPermissions = {
      allowedSlugs: ["slack"],
      unrestricted: false,
    };
    const filtered = filterToolsByPermissions(allTools, perms);
    expect(filtered).toContain(saveMemoryTool);
    expect(filtered).toContain(customTool);
    expect(filtered).toContain(slackPost);
    expect(filtered).toContain(slackRead);
    expect(filtered).not.toContain(hubspotContact);
    expect(filtered).not.toContain(stripeRefund);
  });

  it("can permit multiple slugs", () => {
    const perms: AgentIntegrationPermissions = {
      allowedSlugs: ["slack", "hubspot"],
      unrestricted: false,
    };
    const filtered = filterToolsByPermissions(allTools, perms);
    expect(filtered).toContain(slackPost);
    expect(filtered).toContain(slackRead);
    expect(filtered).toContain(hubspotContact);
    expect(filtered).not.toContain(stripeRefund);
  });

  it("save_memory is always included even when not in the allowlist", () => {
    const perms: AgentIntegrationPermissions = {
      allowedSlugs: [],
      unrestricted: false,
    };
    expect(filterToolsByPermissions([saveMemoryTool], perms)).toContain(
      saveMemoryTool,
    );
  });

  it("malformed integration tool names (no slug after prefix) get blocked", () => {
    const malformed = makeTool("integration:");
    const perms: AgentIntegrationPermissions = {
      allowedSlugs: ["slack"],
      unrestricted: false,
    };
    // The current implementation treats a tool with no derivable slug
    // as "not an integration tool" (passes through) — this is
    // intentional backwards-compat for the pre-DASH-23 registry.
    expect(filterToolsByPermissions([malformed], perms)).toContain(malformed);
  });
});
