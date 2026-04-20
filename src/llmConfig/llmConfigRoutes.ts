/**
 * Express routes for /api/llm-configs.
 * Provides CRUD operations for user LLM provider credentials.
 * API keys are stored encrypted at rest; the raw key is never returned.
 *
 * Authentication: user identity is provided by requireAuth via req.auth.sub.
 */

import { Router, Request, Response } from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { llmConfigStore, LLMProvider } from "./llmConfigStore";

const VALID_PROVIDERS: LLMProvider[] = [
  "openai",
  "anthropic",
  "gemini",
  "mistral",
];

function getUserId(req: AuthenticatedRequest): string | null {
  const userId = req.auth?.sub;
  if (typeof userId !== "string" || !userId.trim()) return null;
  return userId;
}

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/llm-configs — create config, store API key encrypted
// ---------------------------------------------------------------------------
router.post("/", (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const { provider, label, model, apiKey } = req.body as Record<
    string,
    unknown
  >;

  if (
    typeof provider !== "string" ||
    !VALID_PROVIDERS.includes(provider as LLMProvider)
  ) {
    res
      .status(400)
      .json({ error: `provider must be one of: ${VALID_PROVIDERS.join(", ")}` });
    return;
  }
  if (typeof label !== "string" || !label.trim()) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  if (typeof model !== "string" || !model.trim()) {
    res.status(400).json({ error: "model is required" });
    return;
  }
  if (typeof apiKey !== "string" || apiKey.length < 4) {
    res
      .status(400)
      .json({ error: "apiKey is required (minimum 4 characters)" });
    return;
  }

  const config = llmConfigStore.create({
    userId,
    provider: provider as LLMProvider,
    label: label.trim(),
    model: model.trim(),
    apiKey,
  });

  res.status(201).json(config);
});

// ---------------------------------------------------------------------------
// GET /api/llm-configs — list user's configs (keys masked)
// ---------------------------------------------------------------------------
router.get("/", (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const configs = llmConfigStore.list(userId);
  res.json({ configs, total: configs.length });
});

// ---------------------------------------------------------------------------
// PATCH /api/llm-configs/:id/default — set as default for user's LLM steps
// Must be declared before /:id to avoid shadowing
// ---------------------------------------------------------------------------
router.patch("/:id/default", (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const updated = llmConfigStore.setDefault(req.params.id, userId);
  if (!updated) {
    res
      .status(404)
      .json({ error: `LLM config not found: ${req.params.id}` });
    return;
  }

  res.json(updated);
});

// ---------------------------------------------------------------------------
// PATCH /api/llm-configs/:id — update label or model
// ---------------------------------------------------------------------------
router.patch("/:id", (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const { label, model } = req.body as Record<string, unknown>;
  const patch: Partial<{ label: string; model: string }> = {};

  if (label !== undefined) {
    if (typeof label !== "string" || !label.trim()) {
      res.status(400).json({ error: "label must be a non-empty string" });
      return;
    }
    patch.label = label.trim();
  }
  if (model !== undefined) {
    if (typeof model !== "string" || !model.trim()) {
      res.status(400).json({ error: "model must be a non-empty string" });
      return;
    }
    patch.model = model.trim();
  }

  const updated = llmConfigStore.update(req.params.id, userId, patch);
  if (!updated) {
    res
      .status(404)
      .json({ error: `LLM config not found: ${req.params.id}` });
    return;
  }

  res.json(updated);
});

// ---------------------------------------------------------------------------
// DELETE /api/llm-configs/:id — remove config
// ---------------------------------------------------------------------------
router.delete("/:id", (req: AuthenticatedRequest, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required" });
    return;
  }

  const deleted = llmConfigStore.delete(req.params.id, userId);
  if (!deleted) {
    res
      .status(404)
      .json({ error: `LLM config not found: ${req.params.id}` });
    return;
  }

  res.status(204).send();
});

export default router;
