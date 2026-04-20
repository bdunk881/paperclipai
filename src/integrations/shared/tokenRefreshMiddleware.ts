export interface OAuthTokenRefreshMiddlewareOptions<TTokenSet> {
  expiresAt?: string;
  shouldAttemptRefresh: boolean;
  refreshWindowMs?: number;
  getRefreshToken: () => string | null;
  refreshAccessToken: (refreshToken: string) => Promise<TTokenSet>;
  persistRefreshedToken: (tokenSet: TTokenSet) => void | Promise<void>;
  onRefreshSuccess?: () => void | Promise<void>;
  onRefreshFailure?: (error: unknown) => void;
  isKnownError: (error: unknown) => boolean;
  createAuthError: (message: string, statusCode?: number) => Error;
  refreshFailedMessage: string;
}

export function isTokenNearExpiry(expiresAt?: string, refreshWindowMs = 60_000): boolean {
  if (!expiresAt) return false;

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return false;

  return Date.now() >= expiresAtMs - refreshWindowMs;
}

export async function runOAuthTokenRefreshMiddleware<TTokenSet>(
  options: OAuthTokenRefreshMiddlewareOptions<TTokenSet>
): Promise<boolean> {
  if (!options.shouldAttemptRefresh || !isTokenNearExpiry(options.expiresAt, options.refreshWindowMs)) {
    return false;
  }

  try {
    const refreshToken = options.getRefreshToken();
    if (!refreshToken) {
      throw options.createAuthError("Missing refresh token", 401);
    }

    const refreshed = await options.refreshAccessToken(refreshToken);
    await options.persistRefreshedToken(refreshed);
    await options.onRefreshSuccess?.();
    return true;
  } catch (error) {
    options.onRefreshFailure?.(error);
    if (options.isKnownError(error)) {
      throw error;
    }

    throw options.createAuthError(options.refreshFailedMessage, 401);
  }
}
