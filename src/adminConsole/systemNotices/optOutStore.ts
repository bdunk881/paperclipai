/**
 * System-notice opt-out store (HEL-366). Hybrid in-memory / Postgres store of
 * recipients who unsubscribed from maintenance / incident system-status-notice
 * emails. Mirrors the other hybrid stores (gated on isPostgresPersistenceEnabled
 * / inMemoryAllowed). Keyed by lowercased email.
 *
 * IMPORTANT: this is a CATEGORY opt-out consulted only by the status-notice
 * blast — it is NOT the mailer suppression list, so opting out of notices does
 * not block billing / auth mail.
 */

import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
} from "../../db/postgres";

export interface SystemNoticeOptOut {
  email: string;
  source: string | null;
  createdAt: string;
}

// allowlist: hybrid store; in-memory mirror of Postgres-backed data
const memoryStore = new Map<string, SystemNoticeOptOut>();

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function postgresPersistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("systemNoticeOptOutStore requires DATABASE_URL outside development/test.");
}

export const systemNoticeOptOutStore = {
  async optOut(email: string, source?: string | null): Promise<void> {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    if (!postgresPersistenceAvailable()) {
      memoryStore.set(normalized, {
        email: normalized,
        source: source ?? null,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    const pool = getPostgresPool();
    await pool.query(
      `INSERT INTO system_notice_opt_outs (email, source)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET source = EXCLUDED.source`,
      [normalized, source ?? null],
    );
  },

  async isOptedOut(email: string): Promise<boolean> {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    if (!postgresPersistenceAvailable()) {
      return memoryStore.has(normalized);
    }
    const pool = getPostgresPool();
    const res = await pool.query("SELECT 1 FROM system_notice_opt_outs WHERE email = $1", [
      normalized,
    ]);
    return (res.rowCount ?? 0) > 0;
  },

  async list(): Promise<SystemNoticeOptOut[]> {
    if (!postgresPersistenceAvailable()) {
      return Array.from(memoryStore.values()).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1,
      );
    }
    const pool = getPostgresPool();
    const res = await pool.query(
      "SELECT email, source, created_at FROM system_notice_opt_outs ORDER BY created_at DESC",
    );
    return res.rows.map((r) => ({
      email: String(r.email),
      source: r.source ? String(r.source) : null,
      createdAt: new Date(String(r.created_at)).toISOString(),
    }));
  },

  async clear(): Promise<void> {
    memoryStore.clear();
    if (!postgresPersistenceAvailable()) return;
    const pool = getPostgresPool();
    await pool.query("DELETE FROM system_notice_opt_outs");
  },
};
