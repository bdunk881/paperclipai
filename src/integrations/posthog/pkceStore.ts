import { createHash, randomBytes } from "crypto";

interface PkceState {
  userId: string;
  verifier: string;
  createdAt: number;
}

const stateStore = new Map<string, PkceState>();
const PKCE_TTL_MS = 10 * 60 * 1000;

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createPkceState(userId: string): {
  state: string;
  verifier: string;
  challenge: string;
  expiresInSeconds: number;
} {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
  const state = toBase64Url(randomBytes(24));

  stateStore.set(state, {
    userId,
    verifier,
    createdAt: Date.now(),
  });

  return {
    state,
    verifier,
    challenge,
    expiresInSeconds: Math.floor(PKCE_TTL_MS / 1000),
  };
}

export function consumePkceState(state: string): { userId: string; verifier: string } | null {
  const entry = stateStore.get(state);
  if (!entry) return null;

  stateStore.delete(state);
  if (Date.now() - entry.createdAt > PKCE_TTL_MS) {
    return null;
  }

  return {
    userId: entry.userId,
    verifier: entry.verifier,
  };
}

export function clearPkceState(): void {
  stateStore.clear();
}
