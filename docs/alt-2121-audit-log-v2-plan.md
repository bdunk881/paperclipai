# ALT-2121 Audit Log v2 Deprecation Plan

Centralized audit writes now target `control_plane_audit_log` for the tenant-mutating boundaries covered in ALT-2121. The remaining migration-window policy is:

1. Keep `control_plane_audit_log` as the source of truth for new backend audit integrations.
2. Preserve any legacy phase-specific audit tables until staging and production have at least one full release cycle of central-log coverage with no regression findings.
3. During the overlap window, verify that each legacy write path has a matching centralized category/action pair and that downstream consumers can read from the centralized table alone.
4. Only drop legacy phase-specific tables after:
   - staging replay confirms parity for the affected actions,
   - compliance/export consumers have switched to `control_plane_audit_log`,
   - and a removal migration is approved with rollback notes.

Planned v2 cleanup:

- Remove dual-write shims once parity is confirmed.
- Delete legacy table readers and writers in the same release window as the drop migration.
- Keep the category/action contract stable so historical analytics do not need remapping after the table cleanup.
