-- AutoFlow PostgreSQL initialisation
-- Satisfies CIS Control #3 — pgcrypto enables column-level encryption for Restricted-tier fields.
-- See infra/encryption-at-rest.md §1.2B for usage guidance.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
