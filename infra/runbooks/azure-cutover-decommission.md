# Runbook: Phase 5 Cutover and Azure Decommission

This runbook is the execution record for [ALT-2325](/ALT/issues/ALT-2325), the
final Azure exit phase for [ALT-2302](/ALT/issues/ALT-2302).

Use it only after the production frontends are already serving from their
non-Azure targets and the production API replacement is ready to accept live
traffic.

## Goal

Complete the final traffic cutover away from Azure, destroy the remaining Azure
estate in a controlled order, and leave auditable evidence that next month's
Azure forecast is effectively `$0`.

## Inputs and linked references

- Azure inventory and drift baseline:
  [`infra/azure/ALT-2303-resource-inventory.md`](../azure/ALT-2303-resource-inventory.md)
- Legacy production API ingress details:
  [`infra/runbooks/production-api-ingress.md`](production-api-ingress.md)
- Legacy production auth edge cleanup:
  [`infra/runbooks/production-auth-edge-decommission.md`](production-auth-edge-decommission.md)
- Infra source of truth:
  [`infra/azure`](../azure)

## Exit criteria

- `api.helloautoflow.com` no longer resolves to any Azure-managed endpoint
- No public DNS records point at Azure Front Door, Azure Load Balancer,
  Container Apps, or other Azure public endpoints
- Terraform destroy completes for the remaining Azure modules in dependency
  order
- Staging backend Container App is removed
- CIAM decommission checks are complete and Azure-only auth secrets are removed
- Azure billing forecast for next month is `$0` or operationally equivalent

## Evidence to capture

Record these items in the ALT-2325 issue thread as each stage completes:

- UTC timestamp
- operator name
- command or workflow used
- outcome
- artifact link or pasted output excerpt

For the final close-out comment, include:

- deployed production API target
- DNS verification output
- Terraform plan or destroy evidence per module group
- Azure cost or forecast evidence
- Git commit SHA for repo-side runbook/doc changes

## Stage 5a: Production API DNS cutover

1. Confirm the replacement production API is healthy and already serving the
   expected auth and application traffic.
2. Capture the current Azure ingress endpoint from the legacy runbook if it is
   still live.
3. Update `api.helloautoflow.com` DNS to the non-Azure target.
4. Monitor for at least 1 hour:
   - `/health`
   - auth initiate/callback flow
   - Stripe webhook delivery
   - MCP callback or connector flows that depend on the production API host
5. Verify that `dig +short api.helloautoflow.com` and a direct HTTPS probe no
   longer identify an Azure endpoint.

Do not start destructive Azure teardown until the 1-hour observation window is
clean.

## Stage 5b: Terraform destroy sequence

Run `terraform plan -destroy` before each destroy step and attach the summary to
the issue. Use the existing backend config for the live state.

Destroy order:

1. `module.monitoring`
2. `module.security`
3. `module.policy`
4. `module.aks`
5. `module.acr`
6. `module.spoke_staging`
7. `module.spoke_prod`
8. `module.management`
9. `module.hub`

Suggested command pattern:

```bash
cd infra/azure
terraform init -backend-config=backend-config/production.hcl -input=false
terraform plan -destroy -target=module.monitoring -input=false -no-color
terraform destroy -target=module.monitoring -auto-approve
```

If a module fails because state drift already removed the live object, document
the exact address and resolve it with a deliberate state operation before moving
to the next dependency layer.

## Stage 5c: Staging Container Apps cleanup

The staging backend currently has cleanup work outside Terraform state.

Checklist:

- verify no environments still rely on the staging Azure API hostname
- export any last needed app settings or revision history for audit purposes
- delete the staging backend Container App
- delete orphaned Container Apps environment resources if they are no longer used
- verify no Azure DNS, public endpoint, or secret reference remains for the
  staging backend path

## Stage 5d: CIAM cleanup

Only execute this after the auth migration has been stable for at least 7 days.

Checklist:

- search the repo for `ciamlogin.com`, tenant IDs, and retired Azure auth hosts
- confirm no runtime path still depends on Azure-hosted auth edge components
- remove Azure-only GitHub Actions secrets and environment variables that are no
  longer needed after cutover
- delete the retired CIAM tenant only after secret/config removal and production
  auth verification are complete

Keep [`infra/runbooks/production-auth-edge-decommission.md`](production-auth-edge-decommission.md)
as the verification reference for the retired branded auth host.

## Stage 5e: Final Azure subscription cleanup

After the runtime, networking, and auth teardown is complete:

1. Delete the Terraform state resource group `autoflow-tfstate-rg` and any
   backing storage accounts only after exporting any state snapshots required for
   retention.
2. Verify `az resource list` returns no remaining billable AutoFlow resources.
3. Capture subscription cost analysis / forecast evidence showing the next month
   projects to `$0`.
4. Cancel the Azure subscription.
5. Update repo docs to mark Azure as legacy/decommissioned instead of the active
   production path.

## Post-cutover repo cleanup

Once the Azure subscription is fully retired, follow up with repo changes that:

- remove or archive legacy Azure deploy workflows
- remove stale Azure-first language from `README.md` and `infra/README.md`
- preserve only the historical runbooks needed for audit or rollback context

Until then, keep legacy Azure docs clearly labeled as historical so they are not
mistaken for the current production path.
