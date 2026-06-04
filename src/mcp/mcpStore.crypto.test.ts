/**
 * HEL-560: at-rest encryption of the MCP auth header.
 *
 * The main mcpStore tests run in-memory (cache path), so they never exercise
 * the DB encrypt/decrypt boundary. These cover the crypto helpers directly.
 */
import { encryptAuthHeader, decryptAuthHeader } from "./mcpStore";
import { resetSecretEncryptionForTests } from "../controlPlane/secretEncryption";

const KEY = "11".repeat(32); // 32-byte key, hex-encoded

describe("mcpStore auth-header encryption (HEL-560)", () => {
  afterEach(() => {
    delete process.env.CONTROL_PLANE_SECRET_KEY;
    delete process.env.CONTROL_PLANE_SECRET_KEY_VERSION;
    resetSecretEncryptionForTests();
  });

  it("round-trips an auth header through encrypt → decrypt with a configured key", () => {
    process.env.CONTROL_PLANE_SECRET_KEY = KEY;
    resetSecretEncryptionForTests();

    const stored = encryptAuthHeader("Bearer s3cret-token");
    expect(stored).toMatch(/^enc:1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(stored).not.toContain("s3cret-token");
    expect(decryptAuthHeader(stored)).toBe("Bearer s3cret-token");
  });

  it("passes legacy plaintext through unchanged (no enc: prefix), and null → undefined", () => {
    process.env.CONTROL_PLANE_SECRET_KEY = KEY;
    resetSecretEncryptionForTests();

    expect(decryptAuthHeader("Bearer legacy-plaintext")).toBe("Bearer legacy-plaintext");
    expect(decryptAuthHeader(null)).toBeUndefined();
  });

  it("falls back to plaintext when no secret key is configured (keyless dev)", () => {
    delete process.env.CONTROL_PLANE_SECRET_KEY;
    resetSecretEncryptionForTests();

    // No throw — preserves prior behavior rather than breaking MCP.
    expect(encryptAuthHeader("Bearer dev")).toBe("Bearer dev");
    expect(decryptAuthHeader("Bearer dev")).toBe("Bearer dev");
  });

  it("returns undefined (never the raw blob) when ciphertext can't be decrypted", () => {
    process.env.CONTROL_PLANE_SECRET_KEY = KEY;
    resetSecretEncryptionForTests();

    expect(decryptAuthHeader("enc:1:dead:beef:cafe")).toBeUndefined();
  });
});
