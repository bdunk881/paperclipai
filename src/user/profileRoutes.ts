import { Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  getUserPreferences,
  getUserProfile,
  mergeUserPreferences,
  upsertUserProfile,
} from "./profileStore";

const router = Router();

const updateProfileSchema = z.object({
  displayName: z.string().trim().max(200).optional().nullable(),
  timezone: z.string().trim().min(1).max(128),
});

function getAuthenticatedUser(req: AuthenticatedRequest): { id: string; name: string | null } | null {
  const userId = req.auth?.sub?.trim();
  if (!userId) {
    return null;
  }

  return {
    id: userId,
    name: req.auth?.name?.trim() || null,
  };
}

router.get(
  "/profile",
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const user = getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: "Authenticated user required" });
      return;
    }

    const profile = await getUserProfile(user.id);
    res.json({
      profile: {
        displayName: profile?.displayName ?? user.name,
        timezone: profile?.timezone ?? "UTC",
      },
    });
  }),
);

async function handleUpsertProfile(req: AuthenticatedRequest, res: Response) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  const profile = await upsertUserProfile({
    userId: user.id,
    displayName: parsed.data.displayName ?? null,
    timezone: parsed.data.timezone,
  });

  res.json({
    profile: {
      displayName: profile.displayName,
      timezone: profile.timezone,
    },
  });
}

router.patch("/profile", asyncHandler<AuthenticatedRequest>(handleUpsertProfile));
router.put("/profile", asyncHandler<AuthenticatedRequest>(handleUpsertProfile));

// HEL-203 PR 1: per-user UI preferences blob backing ExperienceModeContext
// (Pro/Simple toggle) and any future client-side UI knob. Persisted as a
// JSONB column on `user_profiles` (migrations/058_user_profile_preferences.sql).
//
// The router lives at the same module so the migration-aware store helpers
// (`mergeUserPreferences` / `getUserPreferences`) ship next to the existing
// upsert path. The mount point is /api/user-profile (see src/app.ts), which
// is why the existing /profile router doesn't collide.
const preferencesSchema = z.object({
  preferences: z.record(z.string(), z.unknown()),
});

router.get(
  "/preferences",
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const user = getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: "Authenticated user required" });
      return;
    }
    const preferences = await getUserPreferences(user.id);
    res.json({ preferences });
  }),
);

router.patch(
  "/preferences",
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const user = getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: "Authenticated user required" });
      return;
    }
    const parsed = preferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
      return;
    }
    const preferences = await mergeUserPreferences(user.id, parsed.data.preferences);
    res.json({ preferences });
  }),
);

export default router;
