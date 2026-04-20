/**
 * Apollo webhook receiver — syncs email reply contacts to Attio.
 *
 * POST /api/webhooks/apollo
 *
 * Validates the inbound webhook via a shared secret, extracts contact data
 * from the Apollo `email_reply` event, and upserts the person (and company)
 * into Attio with Lead Source = "May5Launch".
 */

import { Router, Request, Response } from "express";
import { AttioClient } from "./attio-client";
import { ENTITY_CONFIGS, type EntityKey } from "./config";

const router = Router();

// ---------------------------------------------------------------------------
// Types — Apollo webhook payload shapes
// ---------------------------------------------------------------------------

interface ApolloWebhookContact {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  organization_name?: string;
  linkedin_url?: string;
  phone_numbers?: { raw_number: string }[];
  organization?: {
    name?: string;
    primary_domain?: string;
    short_description?: string;
    linkedin_url?: string;
    estimated_num_employees?: number | null;
  };
}

interface ApolloWebhookPayload {
  event?: string;
  data?: {
    contact?: ApolloWebhookContact;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Webhook endpoint
// ---------------------------------------------------------------------------

router.post("/", async (req: Request, res: Response) => {
  // --- Validate shared secret ---
  const webhookSecret = process.env.APOLLO_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[apollo/webhook] APOLLO_WEBHOOK_SECRET not set");
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }

  const authHeader = req.headers["x-apollo-secret"] as string | undefined;
  if (!authHeader || authHeader !== webhookSecret) {
    res.status(401).json({ error: "Invalid or missing webhook secret" });
    return;
  }

  // --- Parse payload ---
  const payload = req.body as ApolloWebhookPayload;

  if (!payload || typeof payload !== "object") {
    res.status(400).json({ error: "Request body must be a JSON object" });
    return;
  }

  if (payload.event !== "email_reply") {
    // Acknowledge non-reply events without processing
    res.json({ received: true, skipped: true, reason: `Unhandled event: ${payload.event}` });
    return;
  }

  const contact = payload.data?.contact;
  if (!contact?.email) {
    res.status(422).json({ error: "Payload missing contact email" });
    return;
  }

  // --- Resolve entity (default to autoflow for May5Launch) ---
  const entityKey: EntityKey = (req.query.entity as EntityKey) || "autoflow";
  const entityConfig = ENTITY_CONFIGS[entityKey];
  if (!entityConfig) {
    res.status(400).json({ error: `Unknown entity: ${entityKey}` });
    return;
  }

  // --- Attio sync ---
  const attioApiKey = process.env.ATTIO_API_KEY;
  if (!attioApiKey) {
    console.error("[apollo/webhook] ATTIO_API_KEY not set");
    res.status(503).json({ error: "Attio integration not configured" });
    return;
  }

  const attio = new AttioClient(attioApiKey);

  try {
    // 1. Upsert company (if org data present)
    let companyRecordId: string | undefined;
    const org = contact.organization;
    if (org?.primary_domain) {
      const companyRecord = await attio.assertCompany(org.primary_domain, {
        name: org.name,
        description: org.short_description || undefined,
        entity: entityConfig.attioEntityTag,
        source: "May5Launch",
        linkedin: org.linkedin_url || undefined,
        employee_range: mapEmployeeRange(org.estimated_num_employees ?? null),
      });
      companyRecordId = companyRecord.id.record_id;

      // Add company to entity's company list (ignore duplicates)
      try {
        await attio.addToList(
          entityConfig.attioCompanyList,
          entityConfig.attioCompanyListParentObject as "people" | "companies",
          companyRecordId
        );
      } catch (err) {
        // 409/duplicate is fine — idempotent
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("409") && !msg.includes("already exists") && !msg.includes("duplicate")) {
          console.warn(`[apollo/webhook] Failed to add company to list: ${msg}`);
        }
      }
    }

    // 2. Upsert person
    const personRecord = await attio.assertPerson(contact.email, {
      firstName: contact.first_name,
      lastName: contact.last_name,
      jobTitle: contact.title,
      entity: entityConfig.attioEntityTag,
      source: "May5Launch",
      linkedin: contact.linkedin_url || undefined,
      phone: contact.phone_numbers?.[0]?.raw_number || undefined,
    });

    // 3. Add person to leads list (ignore duplicates)
    try {
      await attio.addToList(entityConfig.attioLeadsList, "people", personRecord.id.record_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("409") && !msg.includes("already exists") && !msg.includes("duplicate")) {
        console.warn(`[apollo/webhook] Failed to add person to list: ${msg}`);
      }
    }

    console.log(
      `[apollo/webhook] Synced contact ${contact.email} (entity: ${entityKey}, person: ${personRecord.id.record_id})`
    );

    res.json({
      received: true,
      personId: personRecord.id.record_id,
      companyId: companyRecordId || null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[apollo/webhook] Attio sync failed for ${contact.email}: ${msg}`);
    res.status(502).json({ error: `Attio sync failed: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapEmployeeRange(count: number | null): string | undefined {
  if (!count) return undefined;
  if (count <= 10) return "1-10";
  if (count <= 50) return "11-50";
  if (count <= 250) return "51-250";
  if (count <= 1000) return "251-1K";
  if (count <= 5000) return "1K-5K";
  if (count <= 10000) return "5K-10K";
  return "10K+";
}

export default router;
