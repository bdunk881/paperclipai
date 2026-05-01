import express, { Request, Response } from "express";
import passport from "passport";
import { isPostgresConfigured } from "../db/postgres";
import {
  buildSocialAuthRedirect,
  createSocialAuthNonce,
  createSocialAuthState,
  isAllowedSocialRedirectUri,
  parseSocialAuthState,
  readSocialAuthState,
  resolveAppJwtConfig,
  resolveSocialAuthDashboardCallbackUrl,
  signAppUserToken,
  SOCIAL_AUTH_NONCE_COOKIE_NAME,
  SOCIAL_AUTH_NONCE_MAX_AGE_MS,
  type SocialAuthProvider,
} from "./appAuthTokens";
import {
  getSocialAuthConfigurationError,
  isSocialAuthProviderEnabled,
} from "./socialAuthStrategies";

type AuthenticatedSocialUser = {
  id: string;
  email?: string | null;
  displayName?: string | null;
  provider: SocialAuthProvider;
};

const router = express.Router();

function parseProvider(value: string): SocialAuthProvider | null {
  if (value === "google" || value === "facebook" || value === "apple") {
    return value;
  }
  return null;
}

function getStartOptions(provider: SocialAuthProvider, state?: string): Record<string, unknown> {
  if (provider === "google") {
    return { scope: ["profile", "email"], state, session: false };
  }

  if (provider === "facebook") {
    return { scope: ["email"], state, session: false };
  }

  return { scope: ["name", "email"], state, session: false };
}

function ensureSocialAuthReady(res: Response, provider: SocialAuthProvider): boolean {
  if (!resolveAppJwtConfig()) {
    res.status(503).json({ error: "Social auth is not configured." });
    return false;
  }

  if (!isPostgresConfigured()) {
    res.status(503).json({ error: "Social auth requires PostgreSQL persistence." });
    return false;
  }

  const configurationError = getSocialAuthConfigurationError(provider);
  if (configurationError) {
    res.status(503).json({
      error: `Social auth provider is unavailable: ${provider}`,
      details: configurationError,
    });
    return false;
  }

  if (!isSocialAuthProviderEnabled(provider)) {
    res.status(404).json({ error: `Social auth provider is not enabled: ${provider}` });
    return false;
  }

  return true;
}

function getRequestedRedirectUri(req: Request): string | undefined {
  const value = req.query.redirect_uri;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readCookieValue(req: Request, cookieName: string): string | undefined {
  const rawCookieHeader = req.headers.cookie;
  if (typeof rawCookieHeader !== "string" || !rawCookieHeader.trim()) {
    return undefined;
  }

  const cookies = rawCookieHeader.split(";");
  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();
    if (name !== cookieName) {
      continue;
    }

    const value = cookie.slice(separatorIndex + 1).trim();
    return value ? decodeURIComponent(value) : undefined;
  }

  return undefined;
}

function socialAuthNonceCookieOptions(provider: SocialAuthProvider): express.CookieOptions {
  return {
    httpOnly: true,
    maxAge: SOCIAL_AUTH_NONCE_MAX_AGE_MS,
    path: `/api/auth/social/${provider}/callback`,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  };
}

function clearSocialAuthNonceCookie(res: Response, provider: SocialAuthProvider): void {
  const { maxAge: _maxAge, ...options } = socialAuthNonceCookieOptions(provider);
  void _maxAge;
  res.clearCookie(SOCIAL_AUTH_NONCE_COOKIE_NAME, options);
}

function handleFailure(
  req: Request,
  res: Response,
  provider: SocialAuthProvider,
  message: string
): void {
  const state = parseSocialAuthState(readSocialAuthState(req));
  const redirectUri =
    state?.redirectUri && isAllowedSocialRedirectUri(state.redirectUri)
      ? state.redirectUri
      : resolveSocialAuthDashboardCallbackUrl();

  if (redirectUri) {
    res.redirect(
      buildSocialAuthRedirect(redirectUri, {
        error: "social_auth_failed",
        error_description: message,
        provider,
      })
    );
    return;
  }

  res.status(401).json({ error: message });
}

router.get("/:provider", (req, res, next) => {
  const provider = parseProvider(req.params.provider);
  if (!provider) {
    res.status(404).json({ error: `Unsupported social auth provider: ${req.params.provider}` });
    return;
  }

  if (!ensureSocialAuthReady(res, provider)) {
    return;
  }

  const redirectUri = getRequestedRedirectUri(req);
  if (redirectUri && !isAllowedSocialRedirectUri(redirectUri)) {
    res.status(400).json({ error: "redirect_uri is not allowed." });
    return;
  }

  const nonce = createSocialAuthNonce();
  const state = createSocialAuthState({ nonce, redirectUri });
  res.cookie(SOCIAL_AUTH_NONCE_COOKIE_NAME, nonce, socialAuthNonceCookieOptions(provider));
  passport.authenticate(provider, getStartOptions(provider, state))(req, res, next);
});

function runCallback(provider: SocialAuthProvider) {
  return (req: Request, res: Response, next: express.NextFunction) => {
    if (!ensureSocialAuthReady(res, provider)) {
      return;
    }

    passport.authenticate(
      provider,
      { session: false },
      (error: Error | null, user?: AuthenticatedSocialUser | false) => {
        if (error) {
          clearSocialAuthNonceCookie(res, provider);
          handleFailure(req, res, provider, error.message);
          return;
        }

        if (!user) {
          clearSocialAuthNonceCookie(res, provider);
          handleFailure(req, res, provider, "Authentication failed.");
          return;
        }

        const state = parseSocialAuthState(readSocialAuthState(req));
        const nonceCookie = readCookieValue(req, SOCIAL_AUTH_NONCE_COOKIE_NAME);
        clearSocialAuthNonceCookie(res, provider);

        if (!state || !nonceCookie || state.nonce !== nonceCookie) {
          handleFailure(req, res, provider, "Authentication state is invalid or expired.");
          return;
        }

        const token = signAppUserToken({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          provider: user.provider,
        });
        const responseUser = {
          id: user.id,
          email: user.email ?? null,
          name: user.displayName ?? null,
          provider: user.provider,
        };
        const redirectUri =
          state.redirectUri && isAllowedSocialRedirectUri(state.redirectUri)
            ? state.redirectUri
            : resolveSocialAuthDashboardCallbackUrl();

        if (redirectUri) {
          res.redirect(
            buildSocialAuthRedirect(redirectUri, {
              token,
              provider: user.provider,
            })
          );
          return;
        }

        res.json({ token, user: responseUser });
      }
    )(req, res, next);
  };
}

router.get("/:provider/callback", (req, res, next) => {
  const provider = parseProvider(req.params.provider);
  if (!provider) {
    res.status(404).json({ error: `Unsupported social auth provider: ${req.params.provider}` });
    return;
  }

  runCallback(provider)(req, res, next);
});

router.post("/:provider/callback", express.urlencoded({ extended: false }), (req, res, next) => {
  const provider = parseProvider(req.params.provider);
  if (!provider) {
    res.status(404).json({ error: `Unsupported social auth provider: ${req.params.provider}` });
    return;
  }

  runCallback(provider)(req, res, next);
});

export default router;
