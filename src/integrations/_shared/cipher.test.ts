/**
 * Tests for `cipher.ts` — the shared AES-256-GCM secret cipher (HEL-180).
 *
 * Covers:
 *   - round-trip encrypt → decrypt
 *   - random IV per encryption (no determinism that leaks across rows)
 *   - wrong-key rejection
 *   - tampered ciphertext rejection
 *   - malformed-ciphertext rejection
 *   - mask helper
 */

import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  __resetCipherKeyCache,
} from "./cipher";

const ORIGINAL_ENV = process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
  } else {
    process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY = ORIGINAL_ENV;
  }
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
  __resetCipherKeyCache();
});

describe("encryptSecret / decryptSecret", () => {
  beforeEach(() => {
    process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY = "test-key-A";
    __resetCipherKeyCache();
  });

  it("round-trips an arbitrary UTF-8 string", () => {
    const plaintext = "xoxb-12345-abcdef-secret-Slack-bot-token";
    const ciphertext = encryptSecret(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptSecret(ciphertext)).toBe(plaintext);
  });

  it("round-trips unicode + multibyte content", () => {
    const plaintext = "🔐 héllo, sécret! 日本語 — token=abc123";
    const ciphertext = encryptSecret(plaintext);
    expect(decryptSecret(ciphertext)).toBe(plaintext);
  });

  it("emits a different ciphertext on each call (random IV)", () => {
    const plaintext = "same-secret";
    const a = encryptSecret(plaintext);
    const b = encryptSecret(plaintext);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plaintext);
    expect(decryptSecret(b)).toBe(plaintext);
  });

  it("emits the canonical iv:tag:data format", () => {
    const ciphertext = encryptSecret("anything");
    const parts = ciphertext.split(":");
    expect(parts).toHaveLength(3);
    // IV is 12 bytes → 24 hex chars; auth tag is 16 bytes → 32 hex chars.
    expect(parts[0]!.length).toBe(24);
    expect(parts[1]!.length).toBe(32);
    expect(parts[2]!.length).toBeGreaterThan(0);
    // All hex.
    for (const part of parts) {
      expect(part!).toMatch(/^[0-9a-f]+$/);
    }
  });

  it("rejects a ciphertext encrypted under a different key", () => {
    const ciphertext = encryptSecret("secret");
    // Swap the key.
    process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY = "test-key-B";
    __resetCipherKeyCache();
    expect(() => decryptSecret(ciphertext)).toThrow();
  });

  it("rejects a ciphertext whose data segment has been tampered with", () => {
    const ciphertext = encryptSecret("the-real-secret");
    const [iv, tag, data] = ciphertext.split(":");
    // Flip one nibble in the data segment.
    const tamperedHex = (data![0] === "0" ? "f" : "0") + data!.slice(1);
    const tampered = `${iv}:${tag}:${tamperedHex}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects a ciphertext with a tampered auth tag", () => {
    const ciphertext = encryptSecret("the-real-secret");
    const [iv, tag, data] = ciphertext.split(":");
    const tamperedTag = (tag![0] === "0" ? "f" : "0") + tag!.slice(1);
    const tampered = `${iv}:${tamperedTag}:${data}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects malformed ciphertext (wrong segment count)", () => {
    expect(() => decryptSecret("not-a-ciphertext")).toThrow(/Invalid ciphertext format/);
    expect(() => decryptSecret("only:two-parts")).toThrow(/Invalid ciphertext format/);
    expect(() => decryptSecret("a:b:c:d")).toThrow(/Invalid ciphertext format/);
  });

  it("rejects malformed ciphertext (empty segment)", () => {
    expect(() => decryptSecret("aa::cc")).toThrow(/Invalid ciphertext format/);
  });

  it("rejects non-string input to encrypt/decrypt", () => {
    // @ts-expect-error — explicit type violation under test.
    expect(() => encryptSecret(123)).toThrow(/expects a string/);
    // @ts-expect-error — explicit type violation under test.
    expect(() => decryptSecret(null)).toThrow(/expects a string/);
  });
});

describe("encryption key resolution", () => {
  it("fails fast in production when CONNECTOR_CREDENTIAL_ENCRYPTION_KEY is missing", () => {
    delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
    process.env.NODE_ENV = "production";
    __resetCipherKeyCache();
    expect(() => encryptSecret("anything")).toThrow(/required in production/);
  });

  it("falls back to a deterministic key in dev/test when the env var is unset", () => {
    delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
    process.env.NODE_ENV = "test";
    __resetCipherKeyCache();
    // Should not throw — the dev fallback is intentional (see comment in cipher.ts).
    const ciphertext = encryptSecret("anything");
    expect(decryptSecret(ciphertext)).toBe("anything");
  });
});

describe("maskSecret", () => {
  it("keeps the last 4 chars and replaces the rest with stars", () => {
    expect(maskSecret("xoxb-abc-def-9876")).toBe("****9876");
    expect(maskSecret("short")).toBe("****hort");
  });

  it("returns a bare ****  for empty input", () => {
    expect(maskSecret("")).toBe("****");
  });
});
