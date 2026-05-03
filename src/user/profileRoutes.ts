import { Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { getUserProfile, upsertUserProfile } from "./profileStore";

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

router.get("/profile", async (req: AuthenticatedRequest, res) => {
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
});

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

router.patch("/profile", handleUpsertProfile);
router.put("/profile", handleUpsertProfile);

export default router;
