import express from "express";
import { requireAuth, AuthenticatedRequest } from "../../auth/authMiddleware";
import { getTier1HealthHttpStatus } from "../shared/tier1Contract";
import { hubSpotConnectorService } from "./service";
import { logHubSpot } from "./logger";
import { ConnectorError } from "./types";
import { verifyHubSpotWebhook } from "./webhook";
import { asyncHandler } from "../../middleware/asyncHandler";

const router = express.Router();

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function handleError(res: express.Response, error: unknown): void {
  if (error instanceof ConnectorError) {
    res.status(error.statusCode).json({
      error: error.message,
      type: error.type,
    });
    return;
  }

  res.status(500).json({
    error: "Unexpected HubSpot connector error",
    type: "upstream",
  });
}

router.post("/oauth/start", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const flow = hubSpotConnectorService.beginOAuth(userId);
  res.status(201).json(flow);
});

router.get("/oauth/callback", asyncHandler(async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (!code || !state) {
    res.status(400).json({ error: "code and state are required" });
    return;
  }

  const credential = await hubSpotConnectorService.completeOAuth({ code, state });
  res.status(201).json({ connection: credential });
}));

router.post("/connect-api-key", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const body = req.body as { apiKey?: string; privateAppToken?: string };
  const apiKey = body.privateAppToken ?? body.apiKey;
  if (!apiKey || !apiKey.trim()) {
    res.status(400).json({ error: "apiKey or privateAppToken is required" });
    return;
  }

  const connection = await hubSpotConnectorService.connectApiKey({ userId, apiKey: apiKey.trim() });
  res.status(201).json({ connection });
}));

router.get("/connections", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connections = await hubSpotConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
}));

router.post("/test-connection", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const result = await hubSpotConnectorService.testConnection(userId);
  res.json({ success: true, ...result });
}));

router.get("/health", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const health = await hubSpotConnectorService.health(userId);
  res.status(getTier1HealthHttpStatus(health.status)).json(health);
}));

router.delete("/connections/:id", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = await hubSpotConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "HubSpot connection not found" });
    return;
  }

  res.status(204).send();
}));

router.get("/contacts", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const contacts = await hubSpotConnectorService.listContacts(userId);
  res.json({ contacts, total: contacts.length });
}));

router.post("/contacts", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { email, firstname, lastname, company, phone } = req.body as {
    email?: string;
    firstname?: string;
    lastname?: string;
    company?: string;
    phone?: string;
  };

  if (!email?.trim() && !firstname?.trim() && !lastname?.trim()) {
    res.status(400).json({ error: "At least one contact property is required" });
    return;
  }

  const contact = await hubSpotConnectorService.createContact(userId, {
    email: email?.trim(),
    firstname: firstname?.trim(),
    lastname: lastname?.trim(),
    company: company?.trim(),
    phone: phone?.trim(),
  });

  res.status(201).json({ contact });
}));

router.patch("/contacts/:id", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const contactId = req.params.id;
  if (!contactId?.trim()) {
    res.status(400).json({ error: "contact id is required" });
    return;
  }

  const { email, firstname, lastname, company, phone } = req.body as {
    email?: string;
    firstname?: string;
    lastname?: string;
    company?: string;
    phone?: string;
  };

  if (!email && !firstname && !lastname && !company && !phone) {
    res.status(400).json({ error: "At least one field must be provided" });
    return;
  }

  const contact = await hubSpotConnectorService.updateContact(userId, contactId, {
    email: email?.trim(),
    firstname: firstname?.trim(),
    lastname: lastname?.trim(),
    company: company?.trim(),
    phone: phone?.trim(),
  });
  res.json({ contact });
}));

router.get("/companies", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const companies = await hubSpotConnectorService.listCompanies(userId);
  res.json({ companies, total: companies.length });
}));

router.post("/companies", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { name, domain, industry, phone, city, country } = req.body as {
    name?: string;
    domain?: string;
    industry?: string;
    phone?: string;
    city?: string;
    country?: string;
  };

  if (!name?.trim() && !domain?.trim()) {
    res.status(400).json({ error: "name or domain is required" });
    return;
  }

  const company = await hubSpotConnectorService.createCompany(userId, {
    name: name?.trim(),
    domain: domain?.trim(),
    industry: industry?.trim(),
    phone: phone?.trim(),
    city: city?.trim(),
    country: country?.trim(),
  });

  res.status(201).json({ company });
}));

router.patch("/companies/:id", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const companyId = req.params.id;
  if (!companyId?.trim()) {
    res.status(400).json({ error: "company id is required" });
    return;
  }

  const { name, domain, industry, phone, city, country } = req.body as {
    name?: string;
    domain?: string;
    industry?: string;
    phone?: string;
    city?: string;
    country?: string;
  };

  if (!name && !domain && !industry && !phone && !city && !country) {
    res.status(400).json({ error: "At least one field must be provided" });
    return;
  }

  const company = await hubSpotConnectorService.updateCompany(userId, companyId, {
    name: name?.trim(),
    domain: domain?.trim(),
    industry: industry?.trim(),
    phone: phone?.trim(),
    city: city?.trim(),
    country: country?.trim(),
  });
  res.json({ company });
}));

router.get("/deals", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deals = await hubSpotConnectorService.listDeals(userId);
  res.json({ deals, total: deals.length });
}));

router.post("/deals", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { dealname, amount, dealstage, pipeline, closedate } = req.body as {
    dealname?: string;
    amount?: string;
    dealstage?: string;
    pipeline?: string;
    closedate?: string;
  };

  if (!dealname?.trim()) {
    res.status(400).json({ error: "dealname is required" });
    return;
  }

  const deal = await hubSpotConnectorService.createDeal(userId, {
    dealname: dealname.trim(),
    amount: amount?.trim(),
    dealstage: dealstage?.trim(),
    pipeline: pipeline?.trim(),
    closedate: closedate?.trim(),
  });

  res.status(201).json({ deal });
}));

router.patch("/deals/:id", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const dealId = req.params.id;
  if (!dealId?.trim()) {
    res.status(400).json({ error: "deal id is required" });
    return;
  }

  const { dealname, amount, dealstage, pipeline, closedate } = req.body as {
    dealname?: string;
    amount?: string;
    dealstage?: string;
    pipeline?: string;
    closedate?: string;
  };

  if (!dealname && !amount && !dealstage && !pipeline && !closedate) {
    res.status(400).json({ error: "At least one field must be provided" });
    return;
  }

  const deal = await hubSpotConnectorService.updateDeal(userId, dealId, {
    dealname: dealname?.trim(),
    amount: amount?.trim(),
    dealstage: dealstage?.trim(),
    pipeline: pipeline?.trim(),
    closedate: closedate?.trim(),
  });
  res.json({ deal });
}));

export const hubSpotWebhookRouter = express.Router();

hubSpotWebhookRouter.post("/events", express.raw({ type: "application/json" }), (req, res) => {
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!clientSecret) {
    throw new ConnectorError("auth", "HUBSPOT_CLIENT_SECRET is not configured", 503);
  }

  const rawBody = req.body as Buffer;
  verifyHubSpotWebhook({
    method: req.method,
    requestUri: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
    rawBody,
    signatureHeader: req.header("x-hubspot-signature-v3"),
    timestampHeader: req.header("x-hubspot-request-timestamp"),
    eventIdHeader: req.header("x-hubspot-event-id"),
    clientSecret,
  });

  const payload = JSON.parse(rawBody.toString("utf8"));
  const events = Array.isArray(payload) ? payload : [payload];

  logHubSpot({
    event: "webhook",
    level: "info",
    connector: "hubspot",
    message: "HubSpot webhook received",
    metadata: {
      events: events.length,
      subscriptionType: events[0]?.subscriptionType,
    },
  });

  res.status(200).json({ ok: true });
});

export default router;
