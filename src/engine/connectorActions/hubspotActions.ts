import { registerConnectorAction, type ConnectorActionInvocation } from "./registry";

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * HEL-659 / HEL-647: real `hubspot.createContact` on the dynamic action library.
 *
 * Creates a contact in the run owner's connected HubSpot
 * (`hubSpotConnectorService.createContact`). Honest failure (throws → the step
 * fails) when HubSpot isn't connected or no identifying field is supplied —
 * never a fabricated CRM id. The connector is imported lazily inside `invoke`
 * so registration stays cheap (mirrors the Slack seed).
 *
 * Connector-specific id (not the generic `crm.upsertLead`): each CRM connector
 * registers its own actions and the builder surfaces whichever the user has
 * connected — so this generalizes to "all CRMs," not just HubSpot.
 */
async function hubspotCreateContact(
  invocation: ConnectorActionInvocation,
): Promise<Record<string, unknown>> {
  const cfg: Record<string, unknown> = invocation.step.config ?? {};
  const i = invocation.inputs;
  const email = firstString(cfg["email"], i["email"]);
  const firstname = firstString(cfg["firstname"], i["firstname"], i["firstName"]);
  const lastname = firstString(cfg["lastname"], i["lastname"], i["lastName"]);
  const company = firstString(cfg["company"], i["company"]);
  const phone = firstString(cfg["phone"], i["phone"]);
  if (!email && !firstname && !lastname) {
    throw new Error(
      "hubspot.createContact: need at least an email or name (set step.config.email)",
    );
  }
  const { hubSpotConnectorService } = await import("../../integrations/hubspot/service");
  const contact = await hubSpotConnectorService.createContact(invocation.userId, {
    ...(email ? { email } : {}),
    ...(firstname ? { firstname } : {}),
    ...(lastname ? { lastname } : {}),
    ...(company ? { company } : {}),
    ...(phone ? { phone } : {}),
  });
  return { created: true, contactId: contact.id, contact };
}

registerConnectorAction({
  connectorKey: "hubspot",
  actionId: "hubspot.createContact",
  label: "Create a HubSpot contact",
  description: "Create a contact in your connected HubSpot from the step inputs.",
  isWrite: true,
  invoke: hubspotCreateContact,
});
