# Spoke Egress Hardening Rollback Runbook

## Purpose

Emergency rollback path for the NSG outbound hardening introduced after hub firewall removal.

Use this runbook if workloads lose required outbound connectivity after applying spoke NSG deny-by-default rules.

## Scope

- Terraform root: `infra/azure`
- Controls touched:
  - `restrict_spoke_internet_egress` root variable
  - Spoke NSG outbound rules for `aks`, `pe`, and `svc` subnets
  - Network policy audit controls for public IPs and default internet routes

## Trigger Conditions

- AKS nodes fail image pulls or control-plane communication.
- Workloads show sustained outbound timeout/error spikes after deployment.
- Platform dependencies (DNS, identity, package feeds, API dependencies) become unreachable.

## Rollback Procedure

1. Confirm impact:
   - Check AKS node and pod events for network timeouts.
   - Check application health and synthetic probes.
   - Confirm failures started after the hardening deploy timestamp.
2. Disable outbound hardening toggle:
   - Set `restrict_spoke_internet_egress=false` in the active deployment variable set.
   - Keep policy assignments in `Audit` mode during rollback to preserve visibility.
3. Apply rollback:
   - `cd infra/azure`
   - `terraform init`
   - `terraform workspace select <staging|production>`
   - `terraform apply -var="environment=<staging|production>" -var="restrict_spoke_internet_egress=false" ...`
4. Validate recovery:
   - Verify AKS node readiness and workload egress.
   - Verify affected external dependencies recover.
   - Confirm incident metrics return to baseline.
5. Communicate and track:
   - Post rollback timestamp, Terraform run reference, and affected environment in the incident/task thread.
   - Open follow-up task for explicit allow-list expansion before re-enabling hardening.

## Forward Fix (Re-enable)

1. Capture blocked destinations from NSG flow logs and workload telemetry.
2. Add explicit outbound allow rules in IaC for required destinations.
3. Re-enable with:
   - `terraform apply -var="restrict_spoke_internet_egress=true" ...`
4. Validate with staging smoke test before production rollout.

## Validation Checklist

- `terraform fmt -check` passes.
- `terraform validate` passes.
- Staging smoke tests confirm:
  - AKS control plane and node health
  - DNS resolution
  - Required outbound calls for critical services
- Production rollout includes monitoring watch window and on-call acknowledgement.
