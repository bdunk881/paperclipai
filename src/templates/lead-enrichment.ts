/**
 * Template: Lead Enrichment
 *
 * Accepts a raw lead (name + email), enriches it with company and social context,
 * scores the lead with an LLM, then upserts into the CRM.
 *
 * Steps:
 *   1. trigger     — Receive lead input (form submission / webhook)
 *   2. action      — Fetch company info (domain lookup / enrichment API)
 *   3. action      — Fetch social signals (LinkedIn scrape / enrichment API)
 *   4. llm         — Score lead (0–100) with rationale
 *   5. condition   — Route: hot (≥70) vs. nurture (<70)
 *   6. action      — Upsert into CRM with score + context
 *   7. output      — Emit lead-processed event
 */

import { WorkflowTemplate } from "../types/workflow";

export const leadEnrichment: WorkflowTemplate = {
  id: "tpl-lead-enrich",
  name: "Lead Enrichment",
  description:
    "Enriches incoming leads with company and social context, scores them with AI, and routes hot leads to your CRM sales pipeline.",
  category: "sales",
  version: "1.0.0",

  configFields: [
    {
      key: "crmIntegration",
      label: "CRM Integration",
      type: "string",
      required: true,
      options: ["hubspot", "salesforce", "pipedrive", "attio"],
      description: "CRM where enriched leads will be pushed.",
    },
    {
      key: "hotLeadThreshold",
      label: "Hot Lead Score Threshold",
      type: "number",
      required: false,
      defaultValue: 70,
      description: "Leads scoring at or above this value enter the hot pipeline.",
    },
    {
      key: "idealCustomerProfile",
      label: "Ideal Customer Profile (ICP)",
      type: "string",
      required: true,
      description:
        "Describe your ideal customer (e.g. 'Series A SaaS company, 50–200 employees, in the US, using AWS').",
    },
    {
      key: "enrichmentProvider",
      label: "Enrichment Provider",
      type: "string",
      required: false,
      defaultValue: "clearbit",
      options: ["clearbit", "apollo", "hunter"],
      description: "Third-party API used to pull company and contact data.",
    },
    {
      key: "hotLeadOwner",
      label: "Hot Lead Owner (CRM user email)",
      type: "string",
      required: false,
      defaultValue: "",
      description: "CRM user assigned to hot leads automatically.",
    },
  ],

  steps: [
    {
      id: "step_trigger",
      name: "Receive Lead",
      kind: "trigger",
      description: "Accepts a raw lead payload from a form or webhook.",
      inputKeys: [],
      outputKeys: ["leadId", "firstName", "lastName", "email", "companyName", "source"],
    },
    {
      id: "step_enrich_company",
      name: "Enrich Company Data",
      kind: "action",
      description:
        "Calls the configured enrichment provider to fetch company info (size, industry, funding, tech stack).",
      inputKeys: ["email", "companyName", "enrichmentProvider"],
      outputKeys: [
        "companyDomain",
        "companySize",
        "industry",
        "fundingStage",
        "techStack",
        "companyCountry",
      ],
      action: "enrichment.fetchCompany",
    },
    {
      id: "step_enrich_social",
      name: "Enrich Social Signals",
      kind: "action",
      description:
        "Fetches LinkedIn role, seniority, and recent social activity for the contact.",
      inputKeys: ["email", "firstName", "lastName", "companyDomain", "enrichmentProvider"],
      outputKeys: ["jobTitle", "seniority", "linkedinUrl", "recentActivity"],
      action: "enrichment.fetchSocialProfile",
    },
    {
      id: "step_score_lead",
      name: "Score Lead",
      kind: "llm",
      description:
        "Uses the LLM to score the lead 0–100 against the configured ICP and provide a scoring rationale.",
      inputKeys: [
        "idealCustomerProfile",
        "firstName",
        "lastName",
        "email",
        "jobTitle",
        "seniority",
        "companyName",
        "companySize",
        "industry",
        "fundingStage",
        "techStack",
        "companyCountry",
      ],
      outputKeys: ["leadScore", "scoringRationale", "topSignals"],
      promptTemplate:
        "You are a B2B sales qualification assistant.\n\n" +
        "Ideal Customer Profile (ICP): {{idealCustomerProfile}}\n\n" +
        "Lead details:\n" +
        "- Name: {{firstName}} {{lastName}}\n" +
        "- Email: {{email}}\n" +
        "- Title: {{jobTitle}} ({{seniority}})\n" +
        "- Company: {{companyName}}\n" +
        "- Company size: {{companySize}} employees\n" +
        "- Industry: {{industry}}\n" +
        "- Funding: {{fundingStage}}\n" +
        "- Tech stack: {{techStack}}\n" +
        "- Country: {{companyCountry}}\n\n" +
        "Score this lead from 0 to 100 against the ICP. " +
        "Respond with a JSON object:\n" +
        "- leadScore: integer 0–100\n" +
        "- scoringRationale: 2-3 sentence explanation\n" +
        "- topSignals: array of up to 3 strongest positive or negative signals\n\n" +
        "Respond ONLY with the JSON object.",
    },
    {
      id: "step_route",
      name: "Route by Score",
      kind: "condition",
      description: "Determines whether the lead is hot or enters nurture sequence.",
      inputKeys: ["leadScore", "hotLeadThreshold"],
      outputKeys: ["isHotLead"],
      condition: "leadScore >= hotLeadThreshold",
    },
    {
      id: "step_upsert_crm",
      name: "Upsert into CRM",
      kind: "action",
      description:
        "Creates or updates the lead in the configured CRM with enriched data, score, and pipeline assignment.",
      inputKeys: [
        "crmIntegration",
        "leadId",
        "firstName",
        "lastName",
        "email",
        "jobTitle",
        "companyName",
        "companyDomain",
        "leadScore",
        "scoringRationale",
        "isHotLead",
        "hotLeadOwner",
        "linkedinUrl",
        "source",
      ],
      outputKeys: ["crmRecordId", "crmPipeline"],
      action: "crm.upsertLead",
    },
    {
      id: "step_output",
      name: "Emit Lead Processed",
      kind: "output",
      description: "Emits a lead-processed event for analytics.",
      inputKeys: ["leadId", "leadScore", "isHotLead", "crmRecordId", "crmPipeline"],
      outputKeys: ["event"],
      action: "events.emit",
    },
  ],

  sampleInput: {
    leadId: "lead_8a3f2c",
    firstName: "Jordan",
    lastName: "Chen",
    email: "jordan.chen@acmecloud.io",
    companyName: "AcmeCloud",
    source: "landing_page",
  },

  expectedOutput: {
    leadId: "lead_8a3f2c",
    leadScore: 82,
    isHotLead: true,
    crmPipeline: "hot_leads",
    event: {
      type: "lead.processed",
      qualified: true,
    },
  },
};
