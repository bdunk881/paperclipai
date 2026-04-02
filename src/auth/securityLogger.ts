/**
 * Shared structured security event logger.
 *
 * Emits newline-delimited JSON to stdout so CloudWatch can ingest and filter it.
 * All security-relevant events (auth, approvals, config changes) use this logger
 * so metric filters can match a single consistent format.
 *
 * Log entry shape:
 *   { timestamp, event_type, ip?, user_agent?, path?, method?, ...extras }
 */

import { Request } from "express";

export type SecurityEventType =
  | "auth_failure"
  | "auth_success"
  | "authz_failure"
  | "approval_resolved"
  | "llm_config_created"
  | "llm_config_updated"
  | "llm_config_deleted";

export interface SecurityEventExtras {
  [key: string]: unknown;
}

/**
 * Log a structured security event to stdout.
 * If a request is provided, ip / user_agent / path / method are extracted automatically.
 */
export function logSecurityEvent(
  eventType: SecurityEventType,
  extras?: SecurityEventExtras,
  req?: Request
): void {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    event_type: eventType,
  };

  if (req) {
    entry.ip = req.ip ?? (req.socket as { remoteAddress?: string })?.remoteAddress;
    entry.user_agent = req.headers["user-agent"];
    entry.path = req.path;
    entry.method = req.method;
  }

  if (extras) {
    Object.assign(entry, extras);
  }

  console.log(JSON.stringify(entry));
}
