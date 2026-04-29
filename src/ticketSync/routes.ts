import { Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { ticketSyncService } from "./service";

const router = Router();

function resolveWorkspaceContext(req: WorkspaceAwareRequest, res: any, requestedWorkspaceId?: string) {
  const userId = req.auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return null;
  }

  const workspaceId = req.workspaceId?.trim();
  if (!workspaceId) {
    res.status(500).json({ error: "Workspace context was not resolved for the request" });
    return null;
  }

  if (requestedWorkspaceId && requestedWorkspaceId !== workspaceId) {
    res.status(400).json({ error: "workspaceId does not match the resolved workspace context" });
    return null;
  }

  return { workspaceId, userId };
}

const assigneeSchema = z.object({
  type: z.enum(["agent", "user"]),
  id: z.string().trim().min(1),
  role: z.enum(["primary", "collaborator"]),
});

const createConnectionSchema = z.object({
  workspaceId: z.string().uuid(),
  provider: z.enum(["github", "jira", "linear"]),
  authMethod: z.enum(["oauth2_pkce", "api_key", "basic"]),
  label: z.string().trim().min(1).max(120),
  syncDirection: z.enum(["outbound", "inbound", "bidirectional"]).default("bidirectional"),
  enabled: z.boolean().default(true),
  config: z.object({
    owner: z.string().trim().optional(),
    repo: z.string().trim().optional(),
    site: z.string().trim().optional(),
    defaultProjectKey: z.string().trim().optional(),
    defaultIssueType: z.string().trim().optional(),
    defaultTeamId: z.string().trim().optional(),
    defaultProjectId: z.string().trim().optional(),
    webhookSecret: z.string().trim().optional(),
  }).default({}),
  fieldMapping: z.object({
    priority: z.record(z.string()).optional(),
    status: z.record(z.string()).optional(),
    assignee: z.record(z.string()).optional(),
  }).optional(),
  defaultAssignee: assigneeSchema.optional(),
  secrets: z.object({
    token: z.string().trim().optional(),
    email: z.string().trim().optional(),
    apiToken: z.string().trim().optional(),
  }).default({}),
});

const bootstrapConnectionSchema = z.object({
  workspaceId: z.string().uuid(),
  provider: z.enum(["github", "jira", "linear"]),
  label: z.string().trim().min(1).max(120),
  syncDirection: z.enum(["outbound", "inbound", "bidirectional"]).default("bidirectional"),
  enabled: z.boolean().default(true),
  config: z.object({
    owner: z.string().trim().optional(),
    repo: z.string().trim().optional(),
    site: z.string().trim().optional(),
    defaultProjectKey: z.string().trim().optional(),
    defaultIssueType: z.string().trim().optional(),
    defaultTeamId: z.string().trim().optional(),
    defaultProjectId: z.string().trim().optional(),
    webhookSecret: z.string().trim().optional(),
  }).default({}),
  fieldMapping: z.object({
    priority: z.record(z.string()).optional(),
    status: z.record(z.string()).optional(),
    assignee: z.record(z.string()).optional(),
  }).optional(),
  defaultAssignee: assigneeSchema.optional(),
  source: z.object({
    type: z.enum(["integration_connection", "linear_connector"]),
    connectionId: z.string().trim().optional(),
  }),
});

const updateConnectionSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  syncDirection: z.enum(["outbound", "inbound", "bidirectional"]).optional(),
  enabled: z.boolean().optional(),
  config: z.object({
    owner: z.string().trim().optional(),
    repo: z.string().trim().optional(),
    site: z.string().trim().optional(),
    defaultProjectKey: z.string().trim().optional(),
    defaultIssueType: z.string().trim().optional(),
    defaultTeamId: z.string().trim().optional(),
    defaultProjectId: z.string().trim().optional(),
    webhookSecret: z.string().trim().optional(),
  }).optional(),
  fieldMapping: z.object({
    priority: z.record(z.string()).optional(),
    status: z.record(z.string()).optional(),
    assignee: z.record(z.string()).optional(),
  }).optional(),
  defaultAssignee: assigneeSchema.nullish(),
  secrets: z.object({
    token: z.string().trim().optional(),
    email: z.string().trim().optional(),
    apiToken: z.string().trim().optional(),
  }).optional(),
}).refine(
  (value) =>
    value.label !== undefined ||
    value.syncDirection !== undefined ||
    value.enabled !== undefined ||
    value.config !== undefined ||
    value.fieldMapping !== undefined ||
    value.defaultAssignee !== undefined ||
    value.secrets !== undefined,
  { message: "At least one connection field must be provided" },
);

const ticketLinkParamsSchema = z.object({
  ticketId: z.string().uuid(),
});

router.get("/connections", async (req, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "";
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }

  const userId = (req as AuthenticatedRequest).auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connections = await ticketSyncService.listConnections(workspaceId, userId);
  res.json({ connections, total: connections.length });
});

router.post("/connections", async (req: AuthenticatedRequest, res) => {
  const parsed = createConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  const userId = req.auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connection = await ticketSyncService.createConnection({
    userId,
    label: parsed.data.label,
    metadata: {
      workspaceId: parsed.data.workspaceId,
      provider: parsed.data.provider,
      authMethod: parsed.data.authMethod,
      label: parsed.data.label,
      syncDirection: parsed.data.syncDirection,
      enabled: parsed.data.enabled,
      config: parsed.data.config,
      fieldMapping: parsed.data.fieldMapping,
      defaultAssignee: parsed.data.defaultAssignee,
    },
    secrets: parsed.data.secrets,
  });

  res.status(201).json(connection);
});

router.post("/connections/bootstrap", async (req: AuthenticatedRequest, res) => {
  const parsed = bootstrapConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  const userId = req.auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  try {
    const connection = await ticketSyncService.bootstrapConnection({
      userId,
      workspaceId: parsed.data.workspaceId,
      provider: parsed.data.provider,
      label: parsed.data.label,
      syncDirection: parsed.data.syncDirection,
      enabled: parsed.data.enabled,
      config: parsed.data.config,
      fieldMapping: parsed.data.fieldMapping,
      defaultAssignee: parsed.data.defaultAssignee,
      source: parsed.data.source,
    });

    res.status(201).json(connection);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bootstrap failed";
    const statusCode = typeof error === "object" && error && "statusCode" in error && typeof (error as any).statusCode === "number"
      ? (error as any).statusCode
      : 400;
    res.status(statusCode).json({ error: message });
  }
});

router.get("/connections/:id", async (req, res) => {
  const userId = (req as AuthenticatedRequest).auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connection = await ticketSyncService.getConnection(req.params.id, userId);
  if (!connection) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  res.json(connection);
});

router.patch("/connections/:id", async (req: AuthenticatedRequest, res) => {
  const parsed = updateConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  const userId = req.auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connection = await ticketSyncService.updateConnection({
    connectionId: req.params.id,
    userId,
    patch: {
      label: parsed.data.label,
      syncDirection: parsed.data.syncDirection,
      enabled: parsed.data.enabled,
      config: parsed.data.config,
      fieldMapping: parsed.data.fieldMapping,
      defaultAssignee: parsed.data.defaultAssignee ?? undefined,
    },
    secrets: parsed.data.secrets,
  });

  if (!connection) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  res.json(connection);
});

router.delete("/connections/:id", async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const revoked = await ticketSyncService.revokeConnection(req.params.id, userId);
  if (!revoked) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  res.status(204).end();
});

router.post("/connections/:id/test", async (req, res) => {
  const userId = (req as AuthenticatedRequest).auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connection = await ticketSyncService.health(req.params.id, userId);
  if (!connection) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  res.json(connection);
});

router.get("/health", async (req: WorkspaceAwareRequest, res) => {
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "";
  const context = resolveWorkspaceContext(req, res, workspaceId);
  if (!context) {
    return;
  }

  const connections = await ticketSyncService.listConnections(context.workspaceId, context.userId);
  res.json({ connections, total: connections.length });
});

router.get("/tickets/:ticketId/links", async (req: WorkspaceAwareRequest, res) => {
  const parsed = ticketLinkParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "ticketId must be a valid UUID" });
    return;
  }

  const context = resolveWorkspaceContext(req, res);
  if (!context) {
    return;
  }
  const links = await ticketSyncService.listLinks(parsed.data.ticketId, context);
  res.json({ links, total: links.length });
});

export default router;
