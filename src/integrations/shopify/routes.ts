import express from "express";
import { requireAuth, AuthenticatedRequest } from "../../auth/authMiddleware";
import { shopifyConnectorService } from "./service";
import { ConnectorError } from "./types";
import { verifyShopifyWebhook } from "./webhook";
import { logShopify } from "./logger";

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
    error: "Unexpected Shopify connector error",
    type: "upstream",
  });
}

router.post("/oauth/start", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { shopDomain } = req.body as { shopDomain?: string };
  if (!shopDomain || !shopDomain.trim()) {
    res.status(400).json({ error: "shopDomain is required" });
    return;
  }

  try {
    const flow = shopifyConnectorService.beginOAuth({
      userId,
      shopDomain: shopDomain.trim(),
    });
    res.status(201).json(flow);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/oauth/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const shop = typeof req.query.shop === "string" ? req.query.shop : "";

  if (!code || !state) {
    res.status(400).json({ error: "code and state are required" });
    return;
  }

  try {
    const credential = await shopifyConnectorService.completeOAuth({ code, state, shop });
    res.status(201).json({ connection: credential });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/connect-api-key", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { shopDomain, adminApiToken } = req.body as {
    shopDomain?: string;
    adminApiToken?: string;
  };

  if (!shopDomain || !shopDomain.trim()) {
    res.status(400).json({ error: "shopDomain is required" });
    return;
  }
  if (!adminApiToken || !adminApiToken.trim()) {
    res.status(400).json({ error: "adminApiToken is required" });
    return;
  }

  try {
    const connection = await shopifyConnectorService.connectApiKey({
      userId,
      shopDomain: shopDomain.trim(),
      adminApiToken: adminApiToken.trim(),
    });
    res.status(201).json({ connection });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/connections", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connections = shopifyConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
});

router.post("/test-connection", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const result = await shopifyConnectorService.testConnection(userId);
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/health", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const health = await shopifyConnectorService.health(userId);
  const statusCode = health.status === "ok" ? 200 : health.status === "degraded" ? 206 : 503;
  res.status(statusCode).json(health);
});

router.delete("/connections/:id", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = shopifyConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Shopify connection not found" });
    return;
  }

  res.status(204).send();
});

router.get("/products", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const products = await shopifyConnectorService.listProducts(userId);
    res.json({ products, total: products.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/products", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { title, body_html, vendor, product_type } = req.body as {
    title?: string;
    body_html?: string;
    vendor?: string;
    product_type?: string;
  };

  if (!title || !title.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  try {
    const product = await shopifyConnectorService.createProduct(userId, {
      title: title.trim(),
      body_html,
      vendor,
      product_type,
    });
    res.status(201).json({ product });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch("/products/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const product = await shopifyConnectorService.updateProduct(userId, req.params.id, req.body as Record<string, unknown>);
    res.json({ product });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/orders", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const orders = await shopifyConnectorService.listOrders(userId);
    res.json({ orders, total: orders.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/customers", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const customers = await shopifyConnectorService.listCustomers(userId);
    res.json({ customers, total: customers.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/webhooks/subscribe", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { topic, address, format } = req.body as {
    topic?: string;
    address?: string;
    format?: "json" | "xml";
  };

  if (!topic || !topic.trim()) {
    res.status(400).json({ error: "topic is required" });
    return;
  }
  if (!address || !address.trim()) {
    res.status(400).json({ error: "address is required" });
    return;
  }

  try {
    const webhook = await shopifyConnectorService.subscribeWebhook(userId, {
      topic: topic.trim(),
      address: address.trim(),
      format,
    });
    res.status(201).json({ webhook });
  } catch (error) {
    handleError(res, error);
  }
});

export const shopifyWebhookRouter = express.Router();

shopifyWebhookRouter.post("/events", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const signingSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!signingSecret) {
      throw new ConnectorError("auth", "SHOPIFY_WEBHOOK_SECRET is not configured", 503);
    }

    const rawBody = req.body as Buffer;
    verifyShopifyWebhook({
      rawBody,
      hmacHeader: req.header("x-shopify-hmac-sha256"),
      webhookIdHeader: req.header("x-shopify-event-id"),
      signingSecret,
    });

    const payload = JSON.parse(rawBody.toString("utf8"));
    const topic = req.header("x-shopify-topic") ?? "unknown";
    const shopDomain = req.header("x-shopify-shop-domain") ?? "unknown";

    logShopify({
      event: "webhook",
      level: "info",
      connector: "shopify",
      shopDomain,
      message: "Shopify webhook received",
      metadata: {
        topic,
        webhookId: req.header("x-shopify-event-id"),
        payloadKeys: payload && typeof payload === "object" ? Object.keys(payload as Record<string, unknown>).slice(0, 10) : [],
      },
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
