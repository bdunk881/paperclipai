/**
 * Skills API routes (HEL-219).
 *
 *   GET    /api/skills              — list installed skills (name, key,
 *                                     description, license) so the
 *                                     dashboard's agent-edit picker can
 *                                     render a multi-select.
 *   GET    /api/skills/manifest     — admin: read the scanner's
 *                                     `skills/.manifest.json` so the
 *                                     triage page can show needs-review
 *                                     and rejected entries with findings.
 *
 * Read-only for v1. Approve/Reject + Re-scan actions land in a follow-up
 * once we agree on the staging directory layout; today the scanner
 * writes approved skills directly into `skills/` and the manifest
 * records every verdict.
 */

import fs from "fs";
import path from "path";
import { Router } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { asyncHandler } from "../middleware/asyncHandler";
import { getSkillsDir, loadAllSkills } from "./skillsLoader";

interface SkillSummary {
  key: string;
  name: string;
  description: string;
  license?: string;
}

export function createSkillsRoutes(): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler<AuthenticatedRequest>(async (_req, res) => {
      const skills: SkillSummary[] = [];
      for (const skill of loadAllSkills().values()) {
        skills.push({
          key: skill.key,
          name: skill.name,
          description: skill.description,
          license: skill.license,
        });
      }
      skills.sort((a, b) => a.key.localeCompare(b.key));
      res.json({ skills });
    }),
  );

  router.get(
    "/manifest",
    asyncHandler<AuthenticatedRequest>(async (_req, res) => {
      const manifestPath = path.join(getSkillsDir(), ".manifest.json");
      if (!fs.existsSync(manifestPath)) {
        res.json({ entries: [], generatedAt: null });
        return;
      }
      try {
        const raw = fs.readFileSync(manifestPath, "utf8");
        const parsed = JSON.parse(raw) as {
          generatedAt?: string;
          entries?: Record<string, unknown>;
        };
        const entries = Object.values(parsed.entries ?? {});
        res.json({
          entries,
          generatedAt: parsed.generatedAt ?? null,
        });
      } catch (err) {
        console.warn(
          `[skillsRoutes] manifest read failed: ${(err as Error).message}`,
        );
        res.json({ entries: [], generatedAt: null });
      }
    }),
  );

  return router;
}
