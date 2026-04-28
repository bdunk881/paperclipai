import passport from "passport";
import type { SocialAuthProvider } from "./appAuthTokens";
import type { LocalAuthUser, SocialAuthProfileInput } from "./localUserStore";

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
const providerConfigurationErrors = new Map<SocialAuthProvider, string>();
let configured = false;

function setProviderConfigurationError(provider: SocialAuthProvider, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (!providerConfigurationErrors.has(provider)) {
    console.error(`[auth/social] Failed to configure ${provider} strategy: ${message}`);
  }
  providerConfigurationErrors.set(provider, message);
}

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
  };
}

async function verifyAndUpsert(
  provider: SocialAuthProvider,
  profile: ProfileLike,
  done: StrategyDone
): Promise<void> {
  try {
    const normalizedProfile = normalizeSocialProfile(provider, profile);
    const { upsertLocalUserFromSocialProfile } = require("./localUserStore") as typeof import("./localUserStore");
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

  try {
    const { Strategy: GoogleStrategy } =
      require("passport-google-oauth20") as typeof import("passport-google-oauth20");

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
  } catch (error) {
    setProviderConfigurationError("google", error);
  }
}

export function configureSocialAuthStrategies(): void {
  if (configured) {
    return;
  }

  configured = true;
  registerGoogleStrategy();
}

export function listEnabledSocialAuthProviders(): SocialAuthProvider[] {
  configureSocialAuthStrategies();
  return Array.from(enabledProviders);
}

export function isSocialAuthProviderEnabled(provider: SocialAuthProvider): boolean {
  configureSocialAuthStrategies();
  return enabledProviders.has(provider);
}

export function getSocialAuthConfigurationError(provider: SocialAuthProvider): string | null {
  configureSocialAuthStrategies();
  return providerConfigurationErrors.get(provider) ?? null;
}
