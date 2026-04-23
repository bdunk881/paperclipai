import { randomBytes } from "crypto";

interface OAuthState {
  userId: string;
  createdAt: number;
}

const stateStore = new Map<string, OAuthState>();
const STATE_TTL_MS = 10 * 60 * 1000;

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createOAuthState(userId: string): {
  state: string;
  expiresInSeconds: number;
} {
  const state = toBase64Url(randomBytes(24));
  stateStore.set(state, { userId, createdAt: Date.now() });
  return {
    state,
    expiresInSeconds: Math.floor(STATE_TTL_MS / 1000),
  };
}

export function consumeOAuthState(state: string): { userId: string } | null {
  const entry = stateStore.get(state);
  if (!entry) {
    return null;
  }

  stateStore.delete(state);
  if (Date.now() - entry.createdAt > STATE_TTL_MS) {
    return null;
  }

  return { userId: entry.userId };
}

export function clearOAuthState(): void {
  stateStore.clear();
}
