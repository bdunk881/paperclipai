/**
 * Comms reputation metrics (HEL-728).
 *
 * Pure mapping + rate/flag computation over the `admin_comms_reputation`
 * aggregation (migration 108). Per-workspace deliverability: delivery / failure
 * rates from the `comms_sends` statuses, and email bounce / complaint rates from
 * `email_suppressions`, with threshold flags (the SES guidance: complaint > 0.1%,
 * bounce > 5%). No I/O — unit-tested in isolation; the admin route runs the SQL.
 */

/** AWS SES reputation thresholds — exceeding these risks throttling/suspension. */
export const BOUNCE_FLAG_THRESHOLD = 0.05; // 5%
export const COMPLAINT_FLAG_THRESHOLD = 0.001; // 0.1%

/** A per-workspace row as returned by `admin_comms_reputation` (bigints as strings). */
export interface RawReputationDbRow {
  workspace_id: string;
  workspace_name: string;
  sends_total: string | number;
  sent: string | number;
  failed: string | number;
  suppressed: string | number;
  email_sent: string | number;
  email_bounces: string | number;
  email_complaints: string | number;
  last_send_at: string | Date | null;
}

export interface CommsReputationRow {
  workspaceId: string;
  workspaceName: string;
  sendsTotal: number;
  sent: number;
  failed: number;
  suppressed: number;
  emailSent: number;
  emailBounces: number;
  emailComplaints: number;
  lastSendAt: string | null;
}

export interface CommsReputationMetric extends CommsReputationRow {
  /** sent / sendsTotal. */
  deliveryRate: number;
  /** failed / sendsTotal. */
  failureRate: number;
  /** emailBounces / emailSent. */
  bounceRate: number;
  /** emailComplaints / emailSent. */
  complaintRate: number;
  /** Threshold breaches: 'high_bounce' | 'high_complaint'. */
  flags: string[];
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** Normalize a raw DB row (pg returns bigints as strings) into typed numbers. */
export function mapReputationDbRow(row: RawReputationDbRow): CommsReputationRow {
  return {
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    sendsTotal: Number(row.sends_total),
    sent: Number(row.sent),
    failed: Number(row.failed),
    suppressed: Number(row.suppressed),
    emailSent: Number(row.email_sent),
    emailBounces: Number(row.email_bounces),
    emailComplaints: Number(row.email_complaints),
    lastSendAt: row.last_send_at ? new Date(row.last_send_at).toISOString() : null,
  };
}

/** Compute rates + threshold flags for a workspace's reputation row. */
export function toCommsReputationMetric(row: CommsReputationRow): CommsReputationMetric {
  const bounceRate = rate(row.emailBounces, row.emailSent);
  const complaintRate = rate(row.emailComplaints, row.emailSent);
  const flags: string[] = [];
  if (bounceRate > BOUNCE_FLAG_THRESHOLD) {
    flags.push("high_bounce");
  }
  if (complaintRate > COMPLAINT_FLAG_THRESHOLD) {
    flags.push("high_complaint");
  }
  return {
    ...row,
    deliveryRate: rate(row.sent, row.sendsTotal),
    failureRate: rate(row.failed, row.sendsTotal),
    bounceRate,
    complaintRate,
    flags,
  };
}
