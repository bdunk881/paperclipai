import { createHash, randomBytes } from "crypto";
import { AgentCatalogProvider } from "./types";

interface PkceStateEntry {
  state: string;
  verifier: string;
  challenge: string;
  userId: string;
  provider: AgentCatalogProvider;
  expiresAt: number;
}

const EXPIRY_MS = 10 * 60 * 1000;
const store = new Map<string, PkceStateEntry>();

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createVerifier(): string {
  return base64Url(randomBytes(64));
}

function createChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}

export function createPkceState(userId: string, provider: AgentCatalogProvider): PkceStateEntry {
  cleanupExpired();
  const verifier = createVerifier();
  const state = base64Url(randomBytes(24));
  const entry: PkceStateEntry = {
    state,
    verifier,
    challenge: createChallenge(verifier),
    userId,
    provider,
    expiresAt: Date.now() + EXPIRY_MS,
  };
  store.set(state, entry);
  return entry;
}

export function consumePkceState(state: string): PkceStateEntry | null {
  cleanupExpired();
  const entry = store.get(state);
  if (!entry) return null;
  store.delete(state);
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}

export function clearPkceState(): void {
  store.clear();
}
