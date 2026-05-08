import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const DEFAULT_KEY_VERSION = 1;
const ROTATED_KEY_VERSION = 2;
const VERSION_PREFIX_PATTERN = /^v(\d+)$/;

export interface KeyVersionedSecretVaultOptions {
  currentKeyEnvVars: string[];
  previousKeyEnvVars?: string[];
  v2KeyEnvVars?: string[];
  salts?: string[];
  keyLabel?: string;
}

interface ParsedCiphertext {
  keyVersion: number;
  ivHex: string;
  tagHex: string;
  dataHex: string;
}

const EPHEMERAL_KEY_ALLOWED_ENVS = new Set(["development", "test"]);

function parseEnvList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function deriveKeys(seeds: string[], salts: string[]): Buffer[] {
  const seen = new Set<string>();
  const keys: Buffer[] = [];

  for (const seed of seeds) {
    for (const salt of salts) {
      const cacheKey = `${seed}:${salt}`;
      if (seen.has(cacheKey)) {
        continue;
      }

      seen.add(cacheKey);
      keys.push(scryptSync(seed, salt, KEY_LENGTH_BYTES) as Buffer);
    }
  }

  return keys;
}

function getRuntimeEnvironment(): string {
  return (process.env.NODE_ENV ?? "development").trim().toLowerCase();
}

function toV2EnvVar(envVar: string): string {
  return `${envVar}_V2`;
}

function parseCiphertext(ciphertext: string): ParsedCiphertext {
  const parts = ciphertext.split(":");
  if (parts.length === 3) {
    const [ivHex, tagHex, dataHex] = parts;
    if (!ivHex || !tagHex || !dataHex) {
      throw new Error("Invalid ciphertext format");
    }
    return { keyVersion: DEFAULT_KEY_VERSION, ivHex, tagHex, dataHex };
  }

  if (parts.length === 4) {
    const [versionPart, ivHex, tagHex, dataHex] = parts;
    const match = versionPart.match(VERSION_PREFIX_PATTERN);
    const keyVersion = match ? Number(match[1]) : NaN;
    if (!Number.isInteger(keyVersion) || keyVersion < DEFAULT_KEY_VERSION) {
      throw new Error("Invalid ciphertext key version");
    }
    if (!ivHex || !tagHex || !dataHex) {
      throw new Error("Invalid ciphertext format");
    }
    return { keyVersion, ivHex, tagHex, dataHex };
  }

  throw new Error("Invalid ciphertext format");
}

export class KeyVersionedSecretVault {
  private readonly activeKeyVersion: number;

  private readonly primaryKey: Buffer;

  private readonly keysByVersion: Map<number, Buffer[]>;

  private readonly candidateKeys: Buffer[];

  private readonly keyLabel: string;

  constructor(options: KeyVersionedSecretVaultOptions) {
    const salts = options.salts ?? ["autoflow-connector-salt"];
    const currentSeeds = options.currentKeyEnvVars.flatMap((envVar) => parseEnvList(process.env[envVar]));
    const previousSeeds = (options.previousKeyEnvVars ?? []).flatMap((envVar) =>
      parseEnvList(process.env[envVar])
    );
    const v2EnvVars = options.v2KeyEnvVars ?? options.currentKeyEnvVars.map(toV2EnvVar);
    const v2Seeds = v2EnvVars.flatMap((envVar) => parseEnvList(process.env[envVar]));
    this.keyLabel = options.keyLabel ?? "secret";

    const activeSeeds = v2Seeds.length > 0 ? v2Seeds : currentSeeds;
    const primarySeed = activeSeeds[0];
    if (!primarySeed) {
      const runtimeEnvironment = getRuntimeEnvironment();
      if (!EPHEMERAL_KEY_ALLOWED_ENVS.has(runtimeEnvironment)) {
        throw new Error(
          `Missing ${this.keyLabel} encryption key for NODE_ENV=${runtimeEnvironment}. ` +
            `Set one of ${[...v2EnvVars, ...options.currentKeyEnvVars].join(", ")} before starting the server. ` +
            "Ephemeral random fallback is only allowed in development or test."
        );
      }
    }

    this.activeKeyVersion = v2Seeds.length > 0 ? ROTATED_KEY_VERSION : DEFAULT_KEY_VERSION;
    this.primaryKey = primarySeed ? deriveKeys([primarySeed], [salts[0]])[0] : randomBytes(KEY_LENGTH_BYTES);

    const keysByVersion = new Map<number, Buffer[]>();
    const v1Keys = deriveKeys([...currentSeeds, ...previousSeeds], salts);
    const v2Keys = deriveKeys(v2Seeds, salts);
    if (v1Keys.length > 0) {
      keysByVersion.set(DEFAULT_KEY_VERSION, v1Keys);
    }
    if (v2Keys.length > 0) {
      keysByVersion.set(ROTATED_KEY_VERSION, v2Keys);
    }
    if (keysByVersion.size === 0) {
      keysByVersion.set(DEFAULT_KEY_VERSION, [this.primaryKey]);
    }

    this.keysByVersion = keysByVersion;
    this.candidateKeys = Array.from(keysByVersion.values()).flat();
  }

  getActiveKeyVersion(): number {
    return this.activeKeyVersion;
  }

  getCiphertextKeyVersion(ciphertext: string): number {
    return parseCiphertext(ciphertext).keyVersion;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.primaryKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encoded = `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
    return this.activeKeyVersion === DEFAULT_KEY_VERSION
      ? encoded
      : `v${this.activeKeyVersion}:${encoded}`;
  }

  decrypt(ciphertext: string): string {
    const parsed = parseCiphertext(ciphertext);
    const iv = Buffer.from(parsed.ivHex, "hex");
    const tag = Buffer.from(parsed.tagHex, "hex");
    const data = Buffer.from(parsed.dataHex, "hex");
    const versionKeys = this.keysByVersion.get(parsed.keyVersion) ?? [];
    const keys = [...versionKeys, ...this.candidateKeys.filter((key) => !versionKeys.includes(key))];

    for (const key of keys) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        return decipher.update(data).toString("utf8") + decipher.final("utf8");
      } catch {
        continue;
      }
    }

    throw new Error(`Unable to decrypt ${this.keyLabel} with configured key version ${parsed.keyVersion}`);
  }
}

export const KEY_VERSIONED_SECRET_VAULT_CONSTANTS = {
  ALGORITHM,
  KEY_LENGTH_BYTES,
  IV_LENGTH_BYTES,
  DEFAULT_KEY_VERSION,
  ROTATED_KEY_VERSION,
};
