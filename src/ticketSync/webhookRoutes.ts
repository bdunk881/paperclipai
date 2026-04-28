import express from "express";
import { Router } from "express";
import { TrackerError } from "../integrations/tracker-sync";
import { ticketSyncService } from "./service";

const router = Router();

router.use(express.raw({ type: "application/json" }));

router.post("/:provider/:connectionId", async (req, res) => {
  try {
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    }

    const result = await ticketSyncService.handleWebhook({
      provider: req.params.provider as "github" | "jira" | "linear",
      connectionId: req.params.connectionId,
      rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.from([]),
      headers,
    });

    res.status(202).json(result);
  } catch (error) {
    if (error instanceof TrackerError) {
      res.status(error.statusCode).json({ error: error.message, type: error.type });
      return;
    }

    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
