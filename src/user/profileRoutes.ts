import { Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { resolveSupabaseAuthConfig } from "../auth/supabaseAuth";
import { getUserProfile, upsertUserProfile } from "./profileStore";

const router = Router();

const updateProfileSchema = z.object({
  displayName: z.string().trim().max(200).optional().nullable(),
  timezone: z.string().trim().min(1).max(128),
});
const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z.string().min(8, "New password must be at least 8 characters."),
  confirmPassword: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.confirmPassword !== undefined && value.newPassword !== value.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "New password and confirmation must match.",
      path: ["confirmPassword"],
    });
  }

  if (value.currentPassword === value.newPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "New password must be different from the current password.",
      path: ["newPassword"],
    });
  }
});

type SupabaseAuthErrorBody = {
  msg?: string;
  message?: string;
  error_description?: string;
  error?: string;
};

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

function getBearerToken(req: AuthenticatedRequest): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

function resolveSupabasePasswordApiKey(): string | null {
  const candidates = [
    process.env.SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.VITE_SUPABASE_ANON_KEY,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

async function readSupabaseAuthError(response: globalThis.Response): Promise<string> {
  try {
    const body = await response.json() as SupabaseAuthErrorBody;
    return body.message ?? body.msg ?? body.error_description ?? body.error ?? `Supabase auth request failed with status ${response.status}.`;
  } catch {
    return `Supabase auth request failed with status ${response.status}.`;
  }
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

router.patch("/password", async (req: AuthenticatedRequest, res: Response) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    res.status(401).json({ error: "Bearer access token required" });
    return;
  }

  const parsed = updatePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  const userEmail = req.auth?.email?.trim();
  if (!userEmail) {
    res.status(400).json({ error: "Password updates require an email-based Supabase session." });
    return;
  }

  const supabaseConfig = resolveSupabaseAuthConfig();
  const supabaseApiKey = resolveSupabasePasswordApiKey();
  if (!supabaseConfig || !supabaseApiKey) {
    res.status(503).json({ error: "Supabase password updates are not configured on the server." });
    return;
  }

  const reauthResponse = await fetch(
    `${supabaseConfig.projectUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: supabaseApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: userEmail,
        password: parsed.data.currentPassword,
      }),
    }
  );

  if (!reauthResponse.ok) {
    res.status(400).json({ error: "Current password is incorrect." });
    return;
  }

  const updateResponse = await fetch(`${supabaseConfig.projectUrl}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: supabaseApiKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      password: parsed.data.newPassword,
    }),
  });

  if (!updateResponse.ok) {
    const message = await readSupabaseAuthError(updateResponse);
    const status = updateResponse.status >= 500 ? 502 : updateResponse.status;
    res.status(status).json({ error: message });
    return;
  }

  res.json({ success: true });
});

export default router;
