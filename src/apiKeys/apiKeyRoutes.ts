import { Router, Response } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import { ApiKeyStoreError, apiKeyStore, validateApiKeyName } from "./apiKeyStore";

type ApiKeyRequest = AuthenticatedRequest & WorkspaceAwareRequest;

function getContext(req: ApiKeyRequest, res: Response): { workspaceId: string; userId: string } | null {
  const userId = req.auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required." });
    return null;
  }
  const workspaceId = req.workspaceId?.trim();
  if (!workspaceId) {
    res.status(400).json({ error: "Workspace context is required." });
    return null;
  }
  return { workspaceId, userId };
}

function sendRouteError(res: Response, error: unknown): void {
  if (error instanceof ApiKeyStoreError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Unknown API key error.";
  console.warn("[apiKeyRoutes]", message);
  res.status(500).json({ error: "API key operation failed." });
}

export function createApiKeyRoutes(store = apiKeyStore) {
  const router = Router();

  router.get("/", async (req: ApiKeyRequest, res) => {
    const ctx = getContext(req, res);
    if (!ctx) return;
    try {
      const keys = await store.list(ctx);
      res.json({ keys, total: keys.length });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.post("/", async (req: ApiKeyRequest, res) => {
    const ctx = getContext(req, res);
    if (!ctx) return;
    const name = validateApiKeyName((req.body as Record<string, unknown>)?.name);
    if (!name) {
      res.status(400).json({ error: "name must be a non-empty string up to 80 characters." });
      return;
    }

    try {
      const result = await store.create(ctx, name);
      res.status(201).json(result);
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.post("/:id/rotate", async (req: ApiKeyRequest, res) => {
    const ctx = getContext(req, res);
    if (!ctx) return;
    try {
      const result = await store.rotate(ctx, req.params.id);
      if (!result) {
        res.status(404).json({ error: "API key not found." });
        return;
      }
      res.json(result);
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.delete("/:id", async (req: ApiKeyRequest, res) => {
    const ctx = getContext(req, res);
    if (!ctx) return;
    try {
      const revoked = await store.revoke(ctx, req.params.id);
      if (!revoked) {
        res.status(404).json({ error: "API key not found." });
        return;
      }
      res.status(204).send();
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  return router;
}

export default createApiKeyRoutes();
