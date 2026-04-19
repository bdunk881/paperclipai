import express from "express";
import { requireAuth, AuthenticatedRequest } from "../../auth/authMiddleware";
import { logMonitoring } from "./logger";
import { datadogAzureMonitorConnectorService } from "./service";
import { ConnectorError, MonitoringProvider } from "./types";
import { verifyMonitoringWebhook } from "./webhook";

const router = express.Router();

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function parseProvider(value: unknown): MonitoringProvider | undefined {
  if (value === "datadog" || value === "azure_monitor") {
    return value;
  }
  return undefined;
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
    error: "Unexpected Datadog/Azure Monitor connector error",
    type: "upstream",
  });
}

router.post("/oauth/start", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const flow = datadogAzureMonitorConnectorService.beginAzureOAuth(userId);
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
    const credential = await datadogAzureMonitorConnectorService.completeAzureOAuth({ code, state });
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

  const { apiKey, appKey, site } = req.body as {
    apiKey?: string;
    appKey?: string;
    site?: string;
  };

  if (!apiKey || !apiKey.trim()) {
    res.status(400).json({ error: "apiKey is required" });
    return;
  }

  try {
    const connection = await datadogAzureMonitorConnectorService.connectDatadogApiKey({
      userId,
      apiKey: apiKey.trim(),
      appKey: typeof appKey === "string" ? appKey.trim() : undefined,
      site: typeof site === "string" ? site.trim() : undefined,
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

  const connections = datadogAzureMonitorConnectorService.listConnections(userId);
  res.json({ connections, total: connections.length });
});

router.post("/test-connection", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const provider = parseProvider((req.body as { provider?: string }).provider);

  try {
    const result = await datadogAzureMonitorConnectorService.testConnection(userId, provider);
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

  const provider = parseProvider(req.query.provider);
  const health = await datadogAzureMonitorConnectorService.health(userId, provider);
  const statusCode = health.status === "ok" ? 200 : health.status === "degraded" ? 206 : 503;
  res.status(statusCode).json(health);
});

router.delete("/connections/:id", requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const deleted = datadogAzureMonitorConnectorService.disconnect(userId, req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Datadog/Azure Monitor connection not found" });
    return;
  }

  res.status(204).send();
});

router.get("/metrics/datadog", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  const from = Number(req.query.from);
  const to = Number(req.query.to);

  if (!query || !Number.isFinite(from) || !Number.isFinite(to)) {
    res.status(400).json({ error: "query, from, and to are required" });
    return;
  }

  try {
    const metrics = await datadogAzureMonitorConnectorService.queryDatadogMetrics(userId, { query, from, to });
    res.json({ provider: "datadog", metrics, total: metrics.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/metrics/azure/subscriptions", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const subscriptions = await datadogAzureMonitorConnectorService.listAzureSubscriptions(userId);
    res.json({ provider: "azure_monitor", subscriptions, total: subscriptions.length });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/metrics/azure", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const resourceId = typeof req.query.resourceId === "string" ? req.query.resourceId.trim() : "";
  const metricName = typeof req.query.metricName === "string" ? req.query.metricName.trim() : "";
  const timespan = typeof req.query.timespan === "string" ? req.query.timespan.trim() : "";
  const interval = typeof req.query.interval === "string" ? req.query.interval.trim() : undefined;

  if (!resourceId || !metricName || !timespan) {
    res.status(400).json({ error: "resourceId, metricName, and timespan are required" });
    return;
  }

  try {
    const metrics = await datadogAzureMonitorConnectorService.queryAzureMetrics(userId, {
      resourceId,
      metricName,
      timespan,
      interval,
    });
    res.json({ provider: "azure_monitor", metrics, total: metrics.length });
  } catch (error) {
    handleError(res, error);
  }
});

export const datadogAzureMonitorWebhookRouter = express.Router();

datadogAzureMonitorWebhookRouter.post("/alerts", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const rawBody = req.body as Buffer;
    const providerHeader = req.headers["x-monitor-provider"];
    const provider =
      providerHeader === "azure_monitor" || providerHeader === "datadog"
        ? providerHeader
        : "datadog";

    const signatureHeaderRaw = provider === "azure_monitor"
      ? req.headers["x-ms-signature"]
      : req.headers["x-datadog-signature"];

    const deliveryIdHeaderRaw = provider === "azure_monitor"
      ? req.headers["x-ms-request-id"]
      : req.headers["x-datadog-delivery-id"];

    const signatureHeader = Array.isArray(signatureHeaderRaw)
      ? signatureHeaderRaw[0]
      : signatureHeaderRaw;

    const deliveryIdHeader = Array.isArray(deliveryIdHeaderRaw)
      ? deliveryIdHeaderRaw[0]
      : deliveryIdHeaderRaw;

    const signingSecret = provider === "azure_monitor"
      ? process.env.AZURE_MONITOR_WEBHOOK_SIGNING_KEY
      : process.env.DATADOG_WEBHOOK_SIGNING_KEY;

    if (!signingSecret) {
      throw new ConnectorError("auth", `${provider} webhook secret is not configured`, 503);
    }

    verifyMonitoringWebhook({
      provider,
      rawBody,
      signatureHeader,
      deliveryIdHeader,
      signingSecret,
    });

    const payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;

    logMonitoring({
      event: "webhook",
      level: "info",
      connector: "datadog-azure-monitor",
      provider,
      message: `${provider} alert webhook received`,
      metadata: {
        deliveryId: deliveryIdHeader,
        eventType: typeof payload.event_type === "string" ? payload.event_type : undefined,
      },
    });

    res.status(202).json({ ok: true });
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
