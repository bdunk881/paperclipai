/**
 * Retention-class → lifecycle policy (HEL-358).
 *
 * Single source of truth mapping `file_objects.retention_class` to the bucket
 * lifecycle rule that enforces expiry. R2 lifecycle is prefix + age only (no tag
 * filters), so each retention class is a TOP-LEVEL key prefix (see storageKey.ts)
 * and we emit one Expiration rule per prefix. `legal_hold` gets no expiration
 * rule (it must never be auto-deleted; true immutability is a provisioning-time
 * Object Lock / R2 bucket lock — see infra/runbooks/storage-lifecycle.md).
 */

import type { LifecycleConfiguration, LifecycleRule, RetentionClass } from "./storageAdapter";
import { RETENTION_CLASSES } from "./storageKey";

export interface RetentionPolicy {
  /** Days after creation to delete; `null` = never auto-expire (Object Lock / bucket lock). */
  expireAfterDays: number | null;
  /** Whether objects of this class should be immutable (Object Lock / R2 bucket lock). */
  objectLock: boolean;
}

/** The canonical mapping. Mirrors the ticket: short→30d, standard→365d, legal_hold→never. */
export const RETENTION_LIFECYCLE: Record<RetentionClass, RetentionPolicy> = {
  short: { expireAfterDays: 30, objectLock: false },
  standard: { expireAfterDays: 365, objectLock: false },
  legal_hold: { expireAfterDays: null, objectLock: true },
};

/** Abort dangling multipart uploads after a week (matches R2's built-in default). */
export const ABORT_INCOMPLETE_MPU_DAYS = 7;

/** Stable rule id for a retention-class expiration rule (used by the reconciliation diff). */
export function retentionRuleId(retentionClass: RetentionClass): string {
  return `retention-${retentionClass}`;
}

export const ABORT_MPU_RULE_ID = "abort-incomplete-multipart-uploads";

/**
 * Build the canonical bucket `LifecycleConfiguration`:
 *  - one Expiration rule per retention prefix that has a finite TTL
 *    (`legal_hold` is skipped — never auto-expire),
 *  - plus a bucket-wide abort-incomplete-multipart-upload rule.
 *
 * Rule ids are stable so the reconciliation job (storageLifecycleReconcileJob)
 * can diff expected vs actual deterministically. Valid on both S3 and R2 (S3 API).
 */
export function buildLifecycleConfiguration(): LifecycleConfiguration {
  const rules: LifecycleRule[] = [];

  for (const rc of RETENTION_CLASSES) {
    const policy = RETENTION_LIFECYCLE[rc];
    if (policy.expireAfterDays == null) continue; // legal_hold → no expiration rule
    rules.push({
      id: retentionRuleId(rc),
      status: "Enabled",
      prefix: `${rc}/`,
      expirationDays: policy.expireAfterDays,
    });
  }

  rules.push({
    id: ABORT_MPU_RULE_ID,
    status: "Enabled",
    abortIncompleteMultipartUploadDays: ABORT_INCOMPLETE_MPU_DAYS,
  });

  return { rules };
}
