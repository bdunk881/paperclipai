import express from "express";
import { AuthenticatedRequest, requireAuth } from "../../auth/authMiddleware";
import { getTier1HealthHttpStatus } from "../shared/tier1Contract";
import { logStripe } from "./logger";
import { stripeConnectorService } from "./service";
import { ConnectorError } from "./types";
import { verifyStripeWebhook } from "./webhook";

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
    error: "Unexpected Stripe connector error",
    type: "upstream",
  });
}

function parseLimit(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
}

router.post("/oauth/start", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const flow = stripeConnectorService.beginOAuth(userId);
    res.status(201).json(flow);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/oauth/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  if (!code || !state) {
    res.status(400).json({ error: "code and state are required" });
    return;
  }

  try {
    const credential = await stripeConnectorService.completeOAuth({ code, state });
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

  const { apiKey } = req.body as { apiKey?: string };
  if (!apiKey || !apiKey.trim()) {
    res.status(400).json({ error: "apiKey is required" });
    return;
  }

  try {
    const connection = await stripeConnectorService.connectApiKey({ userId, apiKey: apiKey.trim() });
    res.status(201).json({ connection });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/connections", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connections = await stripeConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
});

router.post("/test-connection", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const result = await stripeConnectorService.testConnection(userId);
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

  const health = await stripeConnectorService.health(userId);
  res.status(getTier1HealthHttpStatus(health.status)).json(health);
});

router.delete("/connections/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = await stripeConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Stripe connection not found" });
    return;
  }

  res.status(204).send();
});

router.get("/customers", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const customers = await stripeConnectorService.listCustomers(userId, parseLimit(req.query.limit));
    res.json({ customers, total: customers.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/customers", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { email, name, phone, description, metadata } = req.body as {
    email?: string;
    name?: string;
    phone?: string;
    description?: string;
    metadata?: Record<string, string>;
  };

  if (!email?.trim() && !name?.trim() && !phone?.trim()) {
    res.status(400).json({ error: "At least one customer property is required" });
    return;
  }

  try {
    const customer = await stripeConnectorService.createCustomer(userId, {
      email: email?.trim(),
      name: name?.trim(),
      phone: phone?.trim(),
      description: description?.trim(),
      metadata,
    });
    res.status(201).json({ customer });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch("/customers/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { email, name, phone, description, metadata } = req.body as {
    email?: string;
    name?: string;
    phone?: string;
    description?: string;
    metadata?: Record<string, string>;
  };

  if (!email && !name && !phone && !description && !metadata) {
    res.status(400).json({ error: "At least one field must be provided" });
    return;
  }

  try {
    const customer = await stripeConnectorService.updateCustomer(userId, req.params.id, {
      email: email?.trim(),
      name: name?.trim(),
      phone: phone?.trim(),
      description: description?.trim(),
      metadata,
    });
    res.json({ customer });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/subscriptions", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const subscriptions = await stripeConnectorService.listSubscriptions(userId, {
      customerId: typeof req.query.customerId === "string" ? req.query.customerId.trim() : undefined,
      status: typeof req.query.status === "string" ? req.query.status.trim() : undefined,
      limit: parseLimit(req.query.limit),
    });
    res.json({ subscriptions, total: subscriptions.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/subscriptions", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { customerId, priceId, quantity, trialPeriodDays, metadata } = req.body as {
    customerId?: string;
    priceId?: string;
    quantity?: number;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
  };

  if (!customerId?.trim() || !priceId?.trim()) {
    res.status(400).json({ error: "customerId and priceId are required" });
    return;
  }

  try {
    const subscription = await stripeConnectorService.createSubscription(userId, {
      customerId: customerId.trim(),
      priceId: priceId.trim(),
      quantity,
      trialPeriodDays,
      metadata,
    });
    res.status(201).json({ subscription });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch("/subscriptions/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { priceId, quantity, cancelAtPeriodEnd, metadata } = req.body as {
    priceId?: string;
    quantity?: number;
    cancelAtPeriodEnd?: boolean;
    metadata?: Record<string, string>;
  };

  if (priceId === undefined && quantity === undefined && cancelAtPeriodEnd === undefined && metadata === undefined) {
    res.status(400).json({ error: "At least one field must be provided" });
    return;
  }

  try {
    const subscription = await stripeConnectorService.updateSubscription(userId, req.params.id, {
      priceId: priceId?.trim(),
      quantity,
      cancelAtPeriodEnd,
      metadata,
    });
    res.json({ subscription });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/invoices", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const invoices = await stripeConnectorService.listInvoices(userId, {
      customerId: typeof req.query.customerId === "string" ? req.query.customerId.trim() : undefined,
      status: typeof req.query.status === "string" ? req.query.status.trim() : undefined,
      limit: parseLimit(req.query.limit),
    });
    res.json({ invoices, total: invoices.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/invoices", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { customerId, autoAdvance, collectionMethod, daysUntilDue, metadata } = req.body as {
    customerId?: string;
    autoAdvance?: boolean;
    collectionMethod?: string;
    daysUntilDue?: number;
    metadata?: Record<string, string>;
  };

  if (!customerId?.trim()) {
    res.status(400).json({ error: "customerId is required" });
    return;
  }

  try {
    const invoice = await stripeConnectorService.createInvoice(userId, {
      customerId: customerId.trim(),
      autoAdvance,
      collectionMethod: collectionMethod?.trim(),
      daysUntilDue,
      metadata,
    });
    res.status(201).json({ invoice });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch("/invoices/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { autoAdvance, collectionMethod, daysUntilDue, metadata } = req.body as {
    autoAdvance?: boolean;
    collectionMethod?: string;
    daysUntilDue?: number;
    metadata?: Record<string, string>;
  };

  if (autoAdvance === undefined && collectionMethod === undefined && daysUntilDue === undefined && metadata === undefined) {
    res.status(400).json({ error: "At least one field must be provided" });
    return;
  }

  try {
    const invoice = await stripeConnectorService.updateInvoice(userId, req.params.id, {
      autoAdvance,
      collectionMethod: collectionMethod?.trim(),
      daysUntilDue,
      metadata,
    });
    res.json({ invoice });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete("/invoices/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const deleted = await stripeConnectorService.deleteInvoice(userId, req.params.id);
    res.json({ deleted });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/payment-intents", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const paymentIntents = await stripeConnectorService.listPaymentIntents(userId, {
      customerId: typeof req.query.customerId === "string" ? req.query.customerId.trim() : undefined,
      status: typeof req.query.status === "string" ? req.query.status.trim() : undefined,
      limit: parseLimit(req.query.limit),
    });
    res.json({ paymentIntents, total: paymentIntents.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/payment-intents", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { amount, currency, customerId, description, confirm, paymentMethodId, metadata } = req.body as {
    amount?: number;
    currency?: string;
    customerId?: string;
    description?: string;
    confirm?: boolean;
    paymentMethodId?: string;
    metadata?: Record<string, string>;
  };

  if (!Number.isFinite(amount) || !currency?.trim()) {
    res.status(400).json({ error: "amount and currency are required" });
    return;
  }

  try {
    const paymentIntent = await stripeConnectorService.createPaymentIntent(userId, {
      amount: Number(amount),
      currency: currency.trim(),
      customerId: customerId?.trim(),
      description: description?.trim(),
      confirm,
      paymentMethodId: paymentMethodId?.trim(),
      metadata,
    });
    res.status(201).json({ paymentIntent });
  } catch (error) {
    handleError(res, error);
  }
});

router.patch("/payment-intents/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const { amount, description, metadata } = req.body as {
    amount?: number;
    description?: string;
    metadata?: Record<string, string>;
  };

  if (amount === undefined && description === undefined && metadata === undefined) {
    res.status(400).json({ error: "At least one field must be provided" });
    return;
  }

  try {
    const paymentIntent = await stripeConnectorService.updatePaymentIntent(userId, req.params.id, {
      amount,
      description: description?.trim(),
      metadata,
    });
    res.json({ paymentIntent });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/payment-intents/:id/cancel", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const paymentIntent = await stripeConnectorService.cancelPaymentIntent(userId, req.params.id);
    res.json({ paymentIntent });
  } catch (error) {
    handleError(res, error);
  }
});

export const stripeConnectorWebhookRouter = express.Router();

stripeConnectorWebhookRouter.post("/events", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const signingSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    if (!signingSecret) {
      throw new ConnectorError("auth", "STRIPE_CONNECT_WEBHOOK_SECRET is not configured", 503);
    }

    const rawBody = req.body as Buffer;
    const event = verifyStripeWebhook({
      rawBody,
      signatureHeader: req.header("stripe-signature") ?? undefined,
      signingSecret,
    });

    logStripe({
      event: "webhook",
      level: "info",
      connector: "stripe",
      accountId: event.account,
      message: "Stripe webhook received",
      metadata: {
        eventId: event.id,
        eventType: event.type,
        createdAt: event.createdAt,
        livemode: event.livemode,
      },
    });

    res.status(202).json({ received: true, event });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
