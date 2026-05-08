import { PoolClient } from "pg";
import { closePostgresPool, getPostgresPool } from "../db/postgres";
import { connectorSecretVault, SecretVault } from "../integrations/shared/credentialRegistry";

type CredentialTableName = "connector_credentials" | "llm_credentials";

interface CredentialTableSpec {
  name: CredentialTableName;
  whereColumns: string[];
  selectSql: string;
  updateSql: string;
}

interface CredentialRow {
  service?: string;
  id: string;
  record_data: unknown;
  key_version: number | null;
}

interface RotationResult {
  value: unknown;
  versions: number[];
  rotatedFields: number;
}

interface BackfillOptions {
  write: boolean;
  batchSize: number;
  tables: CredentialTableName[];
}

interface BackfillTableSummary {
  table: CredentialTableName;
  scanned: number;
  updated: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
}

const ACTIVE_ROTATION_KEY_VERSION = 2;
const DEFAULT_BATCH_SIZE = 100;
const TABLE_SPECS: Record<CredentialTableName, CredentialTableSpec> = {
  connector_credentials: {
    name: "connector_credentials",
    whereColumns: ["service", "id"],
    selectSql: `
      SELECT service, id, record_data, key_version
        FROM connector_credentials
       WHERE key_version <> $1
       ORDER BY service ASC, id ASC
       LIMIT $2`,
    updateSql: `
      UPDATE connector_credentials
         SET record_data = $1::jsonb,
             key_version = $2
       WHERE service = $3 AND id = $4`,
  },
  llm_credentials: {
    name: "llm_credentials",
    whereColumns: ["id"],
    selectSql: `
      SELECT id, record_data, key_version
        FROM llm_credentials
       WHERE key_version <> $1
       ORDER BY id ASC
       LIMIT $2`,
    updateSql: `
      UPDATE llm_credentials
         SET record_data = $1::jsonb,
             key_version = $2
       WHERE id = $3`,
  },
};

function normalizeRecordData(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("credential_record_data_invalid");
  }

  return parsed as Record<string, unknown>;
}

function rotateEncryptedFields(value: unknown, vault: SecretVault): RotationResult {
  if (Array.isArray(value)) {
    let rotatedFields = 0;
    const versions: number[] = [];
    const mapped = value.map((item) => {
      const rotated = rotateEncryptedFields(item, vault);
      rotatedFields += rotated.rotatedFields;
      versions.push(...rotated.versions);
      return rotated.value;
    });
    return { value: mapped, versions, rotatedFields };
  }

  if (typeof value !== "object" || value === null) {
    return { value, versions: [], rotatedFields: 0 };
  }

  let rotatedFields = 0;
  const versions: number[] = [];
  const next: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue === "string" && key.endsWith("Encrypted")) {
      const currentVersion = vault.getCiphertextKeyVersion(fieldValue);
      if (currentVersion === vault.getActiveKeyVersion()) {
        next[key] = fieldValue;
        versions.push(currentVersion);
        continue;
      }

      const plaintext = vault.decrypt(fieldValue);
      const rotatedCiphertext = vault.encrypt(plaintext);
      next[key] = rotatedCiphertext;
      versions.push(vault.getCiphertextKeyVersion(rotatedCiphertext));
      rotatedFields += 1;
      continue;
    }

    const rotated = rotateEncryptedFields(fieldValue, vault);
    next[key] = rotated.value;
    versions.push(...rotated.versions);
    rotatedFields += rotated.rotatedFields;
  }

  return { value: next, versions, rotatedFields };
}

async function tableIsSupported(client: PoolClient, tableName: CredentialTableName): Promise<boolean> {
  const exists = await client.query<{ table_exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS table_exists",
    [`public.${tableName}`]
  );
  if (!exists.rows[0]?.table_exists) {
    return false;
  }

  const columns = await client.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = ANY($2::text[])`,
    [tableName, ["record_data", "key_version"]]
  );
  const found = new Set(columns.rows.map((row) => row.column_name));
  return found.has("record_data") && found.has("key_version");
}

async function backfillTable(
  client: PoolClient,
  spec: CredentialTableSpec,
  options: BackfillOptions,
  vault: SecretVault
): Promise<BackfillTableSummary> {
  const supported = await tableIsSupported(client, spec.name);
  if (!supported) {
    console.warn(`[credential-key-backfill] Skipping ${spec.name}: table missing or unsupported`);
    return {
      table: spec.name,
      scanned: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      dryRun: !options.write,
    };
  }

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let batchNumber = 0;

  while (true) {
    batchNumber += 1;
    const result = await client.query<CredentialRow>(spec.selectSql, [
      ACTIVE_ROTATION_KEY_VERSION,
      options.batchSize,
    ]);
    if (result.rows.length === 0) {
      break;
    }

    let batchUpdates = 0;
    for (const row of result.rows) {
      scanned += 1;
      const rowLabel = spec.whereColumns.map((column) => `${column}=${String(row[column as keyof CredentialRow])}`).join(" ");
      try {
        const recordData = normalizeRecordData(row.record_data);
        const rotated = rotateEncryptedFields(recordData, vault);
        if (rotated.versions.length === 0) {
          skipped += 1;
          console.warn(`[credential-key-backfill] Skipping ${spec.name} ${rowLabel}: no encrypted fields found`);
          continue;
        }

        const nextKeyVersion = Math.min(...rotated.versions);
        if (nextKeyVersion !== ACTIVE_ROTATION_KEY_VERSION) {
          throw new Error(`credential_key_version_not_rotated:${nextKeyVersion}`);
        }

        if (rotated.rotatedFields === 0 && row.key_version === ACTIVE_ROTATION_KEY_VERSION) {
          skipped += 1;
          continue;
        }

        if (options.write) {
          const updateParams =
            spec.name === "connector_credentials"
              ? [JSON.stringify(rotated.value), nextKeyVersion, row.service, row.id]
              : [JSON.stringify(rotated.value), nextKeyVersion, row.id];
          await client.query(spec.updateSql, updateParams);
        }

        updated += 1;
        batchUpdates += 1;
        console.info(
          `[credential-key-backfill] ${options.write ? "Updated" : "Would update"} ${spec.name} ${rowLabel} ` +
            `fields=${rotated.rotatedFields} key_version=${nextKeyVersion}`
        );
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[credential-key-backfill] Failed ${spec.name} ${rowLabel}: ${message}`);
      }
    }

    if (!options.write || result.rows.length < options.batchSize) {
      break;
    }

    if (batchUpdates === 0) {
      console.warn(
        `[credential-key-backfill] Stopping ${spec.name}: current batch made no progress; inspect failed/skipped rows`
      );
      break;
    }

    console.info(`[credential-key-backfill] Completed ${spec.name} batch ${batchNumber}`);
  }

  return {
    table: spec.name,
    scanned,
    updated,
    skipped,
    failed,
    dryRun: !options.write,
  };
}

function parseArgs(argv: string[]): BackfillOptions {
  let write = false;
  let batchSize = DEFAULT_BATCH_SIZE;
  let tables: CredentialTableName[] = ["connector_credentials", "llm_credentials"];

  for (const arg of argv) {
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--dry-run") {
      write = false;
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      const parsed = Number(arg.slice("--batch-size=".length));
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error("batch_size_invalid");
      }
      batchSize = parsed;
      continue;
    }
    if (arg.startsWith("--table=")) {
      const table = arg.slice("--table=".length) as CredentialTableName | "all";
      if (table === "all") {
        tables = ["connector_credentials", "llm_credentials"];
      } else if (table === "connector_credentials" || table === "llm_credentials") {
        tables = [table];
      } else {
        throw new Error("table_invalid");
      }
      continue;
    }
    throw new Error(`unknown_argument:${arg}`);
  }

  return { write, batchSize, tables };
}

export async function backfillCredentialEncryptionKey(
  options: BackfillOptions,
  vault = connectorSecretVault
): Promise<BackfillTableSummary[]> {
  if (vault.getActiveKeyVersion() !== ACTIVE_ROTATION_KEY_VERSION) {
    throw new Error("CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_V2_or_LLM_CONFIG_ENCRYPTION_KEY_V2_required");
  }

  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    const summaries: BackfillTableSummary[] = [];
    for (const table of options.tables) {
      summaries.push(await backfillTable(client, TABLE_SPECS[table], options, vault));
    }
    return summaries;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summaries = await backfillCredentialEncryptionKey(options);
  console.info("[credential-key-backfill] Summary", JSON.stringify(summaries));
  const failures = summaries.reduce((count, summary) => count + summary.failed, 0);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("[credential-key-backfill] Fatal", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => {
      void closePostgresPool();
    });
}
