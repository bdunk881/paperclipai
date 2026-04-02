/**
 * Express routes for /api/llm-configs.
 * Provides CRUD operations for user LLM provider credentials.
 * API keys are stored encrypted at rest; the raw key is never returned.
 *
 * Authentication: pass the caller's user ID in the X-User-Id header.
 * Replace with a real auth middleware (JWT, session, etc.) before production.
 */

import { Router, Request, Response } from "express";
import { llmConfigStore, LLMProvider } from "./llmConfigStore";
import { logSecurityEvent } from "../auth/securityLogger";

const VALID_PROVIDERS: LLMProvider[] = [
  "openai",
  "anthropic",
  "gemini",
  "mistral",
];

function getUserId(req: Request): string | null {
  const userId = req.headers["x-user-id"];
  if (typeof userId !== "string" || !userId.trim()) return null;
  return userId.trim();
}

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/llm-configs — create config, store API key encrypted
// ---------------------------------------------------------------------------
router.post("/", (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
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

  logSecurityEvent("llm_config_created", { user_id: userId, config_id: config.id, provider: config.provider }, req);
  res.status(201).json(config);
});

// ---------------------------------------------------------------------------
// GET /api/llm-configs — list user's configs (keys masked)
// ---------------------------------------------------------------------------
router.get("/", (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
    return;
  }

  const configs = llmConfigStore.list(userId);
  res.json({ configs, total: configs.length });
});

// ---------------------------------------------------------------------------
// PATCH /api/llm-configs/:id/default — set as default for user's LLM steps
// Must be declared before /:id to avoid shadowing
// ---------------------------------------------------------------------------
router.patch("/:id/default", (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
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
router.patch("/:id", (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
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

  logSecurityEvent("llm_config_updated", { user_id: userId, config_id: updated.id, provider: updated.provider }, req);
  res.json(updated);
});

// ---------------------------------------------------------------------------
// DELETE /api/llm-configs/:id — remove config
// ---------------------------------------------------------------------------
router.delete("/:id", (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
    return;
  }

  const deleted = llmConfigStore.delete(req.params.id, userId);
  if (!deleted) {
    res
      .status(404)
      .json({ error: `LLM config not found: ${req.params.id}` });
    return;
  }

  logSecurityEvent("llm_config_deleted", { user_id: userId, config_id: req.params.id }, req);
  res.status(204).send();
});

export default router;
