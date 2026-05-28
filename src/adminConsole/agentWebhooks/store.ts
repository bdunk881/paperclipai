/**
 * admin_agent_webhooks + admin_agent_asks repository (HEL infra PR #2).
 *
 * All callers expected to come through requirePlatformAdmin upstream; the
 * SQL here trusts that pre-condition (no RLS bypass tricks).
 *
 * Secrets (HMAC secret + custom headers JSON) are encrypted at the writer
 * level via getAgentWebhookVault() and never returned to API responses —
 * the React app sees only a `secret_present` boolean flag.
 */

import type { Pool, PoolClient } from "pg";
import { getAgentWebhookVault } from "./vault";

export interface AgentWebhookRecord {
  id: string;
  name: string;
  url: string;
  secret_present: boolean;
  custom_headers_present: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  disabled_at: string | null;
}

interface AgentWebhookRow {
  id: string;
  name: string;
  url: string;
  hmac_secret_ciphertext: string | null;
  custom_headers_ciphertext: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  disabled_at: string | null;
}

function toRecord(row: AgentWebhookRow): AgentWebhookRecord {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    secret_present: Boolean(row.hmac_secret_ciphertext),
    custom_headers_present: Boolean(row.custom_headers_ciphertext),
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at,
    disabled_at: row.disabled_at,
  };
}

export interface CreateWebhookInput {
  name: string;
  url: string;
  hmacSecret?: string | null;
  customHeaders?: Record<string, string> | null;
  createdBy: string;
}

export async function createAgentWebhook(
  conn: Pool | PoolClient,
  input: CreateWebhookInput,
): Promise<AgentWebhookRecord> {
  const vault = getAgentWebhookVault();
  const secretCipher = input.hmacSecret ? vault.encrypt(input.hmacSecret) : null;
  const headersCipher = input.customHeaders
    ? vault.encrypt(JSON.stringify(input.customHeaders))
    : null;
  const result = await conn.query<AgentWebhookRow>(
    `INSERT INTO admin_agent_webhooks
       (name, url, hmac_secret_ciphertext, custom_headers_ciphertext, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
    [input.name, input.url, secretCipher, headersCipher, input.createdBy],
  );
  return toRecord(result.rows[0]);
}

export interface UpdateWebhookInput {
  id: string;
  name?: string;
  url?: string;
  hmacSecret?: string | null; // null = clear; undefined = no change
  customHeaders?: Record<string, string> | null;
  disabledAt?: Date | null;
}

export async function updateAgentWebhook(
  conn: Pool | PoolClient,
  input: UpdateWebhookInput,
): Promise<AgentWebhookRecord | null> {
  const vault = getAgentWebhookVault();
  const sets: string[] = [];
  const args: unknown[] = [];
  let i = 1;
  if (input.name !== undefined) {
    sets.push(`name = $${i++}`);
    args.push(input.name);
  }
  if (input.url !== undefined) {
    sets.push(`url = $${i++}`);
    args.push(input.url);
  }
  if (input.hmacSecret !== undefined) {
    sets.push(`hmac_secret_ciphertext = $${i++}`);
    args.push(input.hmacSecret === null ? null : vault.encrypt(input.hmacSecret));
  }
  if (input.customHeaders !== undefined) {
    sets.push(`custom_headers_ciphertext = $${i++}`);
    args.push(
      input.customHeaders === null ? null : vault.encrypt(JSON.stringify(input.customHeaders)),
    );
  }
  if (input.disabledAt !== undefined) {
    sets.push(`disabled_at = $${i++}`);
    args.push(input.disabledAt);
  }
  if (sets.length === 0) {
    const cur = await getAgentWebhook(conn, input.id);
    return cur;
  }
  sets.push(`updated_at = NOW()`);
  args.push(input.id);
  const result = await conn.query<AgentWebhookRow>(
    `UPDATE admin_agent_webhooks
        SET ${sets.join(", ")}
      WHERE id = $${i}
      RETURNING *`,
    args,
  );
  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

export async function getAgentWebhook(
  conn: Pool | PoolClient,
  id: string,
): Promise<AgentWebhookRecord | null> {
  const result = await conn.query<AgentWebhookRow>(
    `SELECT * FROM admin_agent_webhooks WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

export async function listAgentWebhooks(
  conn: Pool | PoolClient,
  opts: { includeDisabled?: boolean } = {},
): Promise<AgentWebhookRecord[]> {
  const where = opts.includeDisabled ? "" : "WHERE disabled_at IS NULL";
  const result = await conn.query<AgentWebhookRow>(
    `SELECT * FROM admin_agent_webhooks ${where} ORDER BY created_at DESC`,
  );
  return result.rows.map(toRecord);
}

export async function deleteAgentWebhook(conn: Pool | PoolClient, id: string): Promise<boolean> {
  const result = await conn.query(`DELETE FROM admin_agent_webhooks WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Returns the decrypted HMAC secret + custom headers for a webhook so the
 * deliverer can sign + add headers. Never expose the return value to the
 * React app.
 */
export async function loadDeliveryMaterial(
  conn: Pool | PoolClient,
  id: string,
): Promise<{
  webhook: AgentWebhookRecord;
  hmacSecret: string | null;
  customHeaders: Record<string, string> | null;
} | null> {
  const result = await conn.query<AgentWebhookRow>(
    `SELECT * FROM admin_agent_webhooks WHERE id = $1 AND disabled_at IS NULL`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const vault = getAgentWebhookVault();
  return {
    webhook: toRecord(row),
    hmacSecret: row.hmac_secret_ciphertext ? vault.decrypt(row.hmac_secret_ciphertext) : null,
    customHeaders: row.custom_headers_ciphertext
      ? (JSON.parse(vault.decrypt(row.custom_headers_ciphertext)) as Record<string, string>)
      : null,
  };
}

export async function markWebhookUsed(
  conn: Pool | PoolClient,
  id: string,
): Promise<void> {
  await conn.query(`UPDATE admin_agent_webhooks SET last_used_at = NOW() WHERE id = $1`, [id]);
}

// ---- admin_agent_asks ------------------------------------------------------

export type AskStatus = "pending" | "sent" | "delivered" | "failed";

export interface InsertAskInput {
  webhookId: string;
  adminUserId: string;
  kind: string;
  source: string;
  subjectRef: Record<string, unknown>;
  payload: Record<string, unknown>;
  adminQuestion: string;
}

export interface AskRow {
  id: string;
  agent_webhook_id: string;
  admin_user_id: string;
  kind: string;
  source: string;
  subject_ref: Record<string, unknown>;
  payload: Record<string, unknown>;
  admin_question: string;
  status: AskStatus;
  http_status: number | null;
  response_excerpt: string | null;
  sent_at: string;
  completed_at: string | null;
}

export async function insertAsk(
  conn: Pool | PoolClient,
  input: InsertAskInput,
): Promise<AskRow> {
  const result = await conn.query<AskRow>(
    `INSERT INTO admin_agent_asks
       (agent_webhook_id, admin_user_id, kind, source, subject_ref, payload, admin_question, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, 'pending')
       RETURNING *`,
    [
      input.webhookId,
      input.adminUserId,
      input.kind,
      input.source,
      JSON.stringify(input.subjectRef),
      JSON.stringify(input.payload),
      input.adminQuestion,
    ],
  );
  return result.rows[0];
}

export async function completeAsk(
  conn: Pool | PoolClient,
  input: { id: string; status: AskStatus; httpStatus?: number | null; responseExcerpt?: string | null },
): Promise<void> {
  await conn.query(
    `UPDATE admin_agent_asks
        SET status = $2,
            http_status = $3,
            response_excerpt = $4,
            completed_at = NOW()
      WHERE id = $1`,
    [input.id, input.status, input.httpStatus ?? null, input.responseExcerpt ?? null],
  );
}

export async function listRecentAsksForWebhook(
  conn: Pool | PoolClient,
  webhookId: string,
  limit = 25,
): Promise<AskRow[]> {
  const result = await conn.query<AskRow>(
    `SELECT * FROM admin_agent_asks
      WHERE agent_webhook_id = $1
      ORDER BY sent_at DESC
      LIMIT $2`,
    [webhookId, limit],
  );
  return result.rows;
}

export async function getAskById(
  conn: Pool | PoolClient,
  askId: string,
): Promise<AskRow | null> {
  const result = await conn.query<AskRow>(
    `SELECT * FROM admin_agent_asks WHERE id = $1`,
    [askId],
  );
  return result.rows[0] ?? null;
}

// ---- admin_agent_replies ---------------------------------------------------

export interface ReplyRow {
  id: string;
  ask_id: string;
  body: string;
  metadata: Record<string, unknown>;
  received_at: string;
  signature_verified: boolean;
}

export async function insertReply(
  conn: Pool | PoolClient,
  input: { askId: string; body: string; metadata?: Record<string, unknown> },
): Promise<ReplyRow> {
  const result = await conn.query<ReplyRow>(
    `INSERT INTO admin_agent_replies (ask_id, body, metadata)
       VALUES ($1, $2, $3::jsonb)
       RETURNING *`,
    [input.askId, input.body, JSON.stringify(input.metadata ?? {})],
  );
  return result.rows[0];
}

export async function listRepliesForAsk(
  conn: Pool | PoolClient,
  askId: string,
  limit = 50,
): Promise<ReplyRow[]> {
  const result = await conn.query<ReplyRow>(
    `SELECT * FROM admin_agent_replies
      WHERE ask_id = $1
      ORDER BY received_at DESC
      LIMIT $2`,
    [askId, limit],
  );
  return result.rows;
}
