import { randomBytes } from "crypto";

const PRIMARY_KEY_HEX = randomBytes(32).toString("hex");
const SECONDARY_KEY_HEX = randomBytes(32).toString("hex");

function reloadModule() {
  jest.resetModules();
  return import("./secretEncryption");
}

describe("secretEncryption", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CONTROL_PLANE_SECRET_KEY = PRIMARY_KEY_HEX;
    delete process.env.CONTROL_PLANE_SECRET_KEYS;
    delete process.env.CONTROL_PLANE_SECRET_KEY_VERSION;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (
        key === "CONTROL_PLANE_SECRET_KEY" ||
        key === "CONTROL_PLANE_SECRET_KEYS" ||
        key === "CONTROL_PLANE_SECRET_KEY_VERSION"
      ) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("encrypts and decrypts a plaintext value with random IV", async () => {
    const mod = await reloadModule();
    const a = mod.encryptSecret("hello world");
    const b = mod.encryptSecret("hello world");
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(mod.decryptSecret(a)).toBe("hello world");
    expect(mod.decryptSecret(b)).toBe("hello world");
  });

  it("uses 12-byte IV and 16-byte auth tag", async () => {
    const mod = await reloadModule();
    const record = mod.encryptSecret("sk-abc123");
    expect(record.iv.length).toBe(12);
    expect(record.authTag.length).toBe(16);
    expect(record.keyVersion).toBe(1);
  });

  it("throws when the auth tag is tampered with", async () => {
    const mod = await reloadModule();
    const record = mod.encryptSecret("payload-of-importance");
    record.authTag[0] = record.authTag[0] ^ 0xff;
    expect(() => mod.decryptSecret(record)).toThrow();
  });

  it("throws when the ciphertext is tampered with", async () => {
    const mod = await reloadModule();
    const record = mod.encryptSecret("payload-of-importance");
    record.ciphertext[0] = record.ciphertext[0] ^ 0xff;
    expect(() => mod.decryptSecret(record)).toThrow();
  });

  it("throws when the master key is missing", async () => {
    delete process.env.CONTROL_PLANE_SECRET_KEY;
    const mod = await reloadModule();
    expect(() => mod.encryptSecret("anything")).toThrow(/CONTROL_PLANE_SECRET_KEY_missing/);
  });

  it("throws when the master key is the wrong length", async () => {
    process.env.CONTROL_PLANE_SECRET_KEY = "deadbeef";
    const mod = await reloadModule();
    expect(() => mod.encryptSecret("anything")).toThrow(/CONTROL_PLANE_SECRET_KEY_invalid_length/);
  });

  it("supports decrypting with a previously rotated key version", async () => {
    process.env.CONTROL_PLANE_SECRET_KEY = PRIMARY_KEY_HEX;
    process.env.CONTROL_PLANE_SECRET_KEY_VERSION = "2";
    process.env.CONTROL_PLANE_SECRET_KEYS = `1:${SECONDARY_KEY_HEX}`;

    const mod = await reloadModule();
    expect(mod.getActiveKeyVersion()).toBe(2);

    const v1Record = mod.encryptSecret("legacy", 1);
    const v2Record = mod.encryptSecret("rotated");
    expect(v1Record.keyVersion).toBe(1);
    expect(v2Record.keyVersion).toBe(2);
    expect(mod.decryptSecret(v1Record)).toBe("legacy");
    expect(mod.decryptSecret(v2Record)).toBe("rotated");
  });

  it("rejects decrypts targeting an unavailable key version", async () => {
    const mod = await reloadModule();
    const record = mod.encryptSecret("only-v1");
    const tampered = { ...record, keyVersion: 99 };
    expect(() => mod.decryptSecret(tampered)).toThrow(/control_plane_secret_key_version_99_unavailable/);
  });
});
