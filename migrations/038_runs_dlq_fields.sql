-- Migration 038: Add failure_reason + failed_at to runs for DLQ support (HEL-110)

BEGIN;

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;

COMMIT;
