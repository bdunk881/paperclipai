import fs from "fs";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import AppleStrategy from "@nicokaiser/passport-apple";
import type { SocialAuthProvider } from "./appAuthTokens";
import {
  upsertLocalUserFromSocialProfile,
  type LocalAuthUser,
  type SocialAuthProfileInput,
} from "./localUserStore";

type VerifiedUser = LocalAuthUser & { provider: SocialAuthProvider };

type ProfileLike = {
  id?: string;
  displayName?: string;
  emails?: Array<{ value?: string }>;
  photos?: Array<{ value?: string }>;
  name?: {
    givenName?: string;
    familyName?: string;
    firstName?: string;
    lastName?: string;
  };
  email?: string;
  _json?: Record<string, unknown>;
  [key: string]: unknown;
};

type StrategyDone = (error: Error | null, user?: VerifiedUser | false) => void;

const enabledProviders = new Set<SocialAuthProvider>();
let configured = false;

function normalizeHttpsUrl(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveCallbackUrl(provider: SocialAuthProvider): string | null {
  const explicitEnv =
    provider === "google"
      ? process.env.GOOGLE_CALLBACK_URL
      : provider === "facebook"
        ? process.env.FACEBOOK_CALLBACK_URL
        : process.env.APPLE_CALLBACK_URL;
  const explicit = normalizeHttpsUrl(explicitEnv);
  if (explicit) {
    return explicit;
  }

  const base = normalizeHttpsUrl(process.env.SOCIAL_AUTH_CALLBACK_BASE_URL);
  if (!base) {
    return null;
  }

  return `${base.replace(/\/+$/, "")}/${provider}/callback`;
}

function normalizeApplePrivateKey(): string | null {
  const inline = process.env.APPLE_PRIVATE_KEY?.trim();
  if (inline) {
    return inline.replace(/\\n/g, "\n");
  }

  const keyPath = process.env.APPLE_PRIVATE_KEY_PATH?.trim();
  if (!keyPath) {
    return null;
  }

  try {
    return fs.readFileSync(keyPath, "utf8");
  } catch {
    return null;
  }
}

function normalizeSocialProfile(
  provider: SocialAuthProvider,
  profile: ProfileLike
): SocialAuthProfileInput {
  const email =
    typeof profile.email === "string"
      ? profile.email
      : typeof profile.emails?.[0]?.value === "string"
        ? profile.emails[0]?.value
        : null;
  const photo =
    typeof profile.photos?.[0]?.value === "string" ? profile.photos[0]?.value : null;
  const displayName =
    typeof profile.displayName === "string" && profile.displayName.trim()
      ? profile.displayName.trim()
      : [profile.name?.givenName ?? profile.name?.firstName, profile.name?.familyName ?? profile.name?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() || null;

  return {
    provider,
    providerSubject: typeof profile.id === "string" ? profile.id : "",
    email,
    displayName,
    avatarUrl: photo,
    rawProfile: (profile._json ?? profile) as Record<string, unknown>,
  };
}

async function verifyAndUpsert(
  provider: SocialAuthProvider,
  profile: ProfileLike,
  done: StrategyDone
): Promise<void> {
  try {
    const normalizedProfile = normalizeSocialProfile(provider, profile);
    const user = await upsertLocalUserFromSocialProfile(normalizedProfile);
    done(null, { ...user, provider });
  } catch (error) {
    done(error as Error);
  }
}

function registerGoogleStrategy(): void {
  const clientID = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const callbackURL = resolveCallbackUrl("google");
  if (!clientID || !clientSecret || !callbackURL) {
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL,
      },
      async (_accessToken: string, _refreshToken: string, profile: ProfileLike, done: StrategyDone) => {
        await verifyAndUpsert("google", profile, done);
      }
    ) as never
  );
  enabledProviders.add("google");
}

function registerFacebookStrategy(): void {
  const clientID = process.env.FACEBOOK_APP_ID?.trim();
  const clientSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  const callbackURL = resolveCallbackUrl("facebook");
  if (!clientID || !clientSecret || !callbackURL) {
    return;
  }

  passport.use(
    new FacebookStrategy(
      {
        clientID,
        clientSecret,
        callbackURL,
        profileFields: ["id", "displayName", "emails", "name", "photos"],
      },
      async (_accessToken: string, _refreshToken: string, profile: ProfileLike, done: StrategyDone) => {
        await verifyAndUpsert("facebook", profile, done);
      }
    ) as never
  );
  enabledProviders.add("facebook");
}

function registerAppleStrategy(): void {
  const clientID = process.env.APPLE_CLIENT_ID?.trim();
  const teamID = process.env.APPLE_TEAM_ID?.trim();
  const keyID = process.env.APPLE_KEY_ID?.trim();
  const key = normalizeApplePrivateKey();
  const callbackURL = resolveCallbackUrl("apple");
  if (!clientID || !teamID || !keyID || !key || !callbackURL) {
    return;
  }

  passport.use(
    new AppleStrategy(
      {
        clientID,
        teamID,
        keyID,
        key,
        callbackURL,
        scope: ["name", "email"],
      } as never,
      async (_accessToken: string, _refreshToken: string, profile: ProfileLike, done: StrategyDone) => {
        await verifyAndUpsert("apple", profile, done);
      }
    ) as never
  );
  enabledProviders.add("apple");
}

export function configureSocialAuthStrategies(): void {
  if (configured) {
    return;
  }

  configured = true;
  registerGoogleStrategy();
  registerFacebookStrategy();
  registerAppleStrategy();
}

export function listEnabledSocialAuthProviders(): SocialAuthProvider[] {
  configureSocialAuthStrategies();
  return Array.from(enabledProviders);
}

export function isSocialAuthProviderEnabled(provider: SocialAuthProvider): boolean {
  configureSocialAuthStrategies();
  return enabledProviders.has(provider);
}
