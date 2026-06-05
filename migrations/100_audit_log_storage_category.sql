-- Migration 100: allow the 'storage' audit category (HEL-359)
--
-- HEL-359 wires every storage adapter operation (/api/files upload-URL issue,
-- download-URL issue, delete) into the canonical tenant audit ledger via
-- auditService.recordAction (src/auditing/auditService.ts). The
-- audit_log.category CHECK (last set in migration 025) must accept the new
-- 'storage' category, mirrored by the AuditCategory union in auditService.ts.
--
-- Idempotent + transactional: DROP IF EXISTS then re-ADD the constraint with
-- the full set re-listed so it stays self-contained (mirrors migration 025).

BEGIN;

ALTER TABLE audit_log
  DROP CONSTRAINT IF EXISTS audit_log_category_check;

ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_category_check
  CHECK (
    category IN (
      'secret',
      'provisioning',
      'team_lifecycle',
      'agent_lifecycle',
      'execution',
      'auth',
      'bypass_attempt',
      'billing',
      'entitlement',
      'connector_connection',
      'llm_credential',
      'budget',
      'storage'
    )
  );

COMMIT;
