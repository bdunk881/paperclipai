# Staging Key Vault Recovery for Azure Container Apps

Use this runbook when the staging backend reports `getaddrinfo ENOTFOUND` or repeated startup failures while loading Key Vault secrets.

## Symptoms

- Sentry shows repeated Key Vault secret load failures during staging backend startup.
- The staging backend revision is healthy enough to deploy, but runtime features depending on `DATABASE_URL`, `REDIS_URL`, Stripe, Entra, or Apollo secrets fail.
- `AZURE_KEY_VAULT_URI` on the Container App does not match the live staging Key Vault URI.

## Verify the live staging resources

Find the active staging Container App and managed environment:

```bash
az containerapp list \
  --query "[].{name:name,resourceGroup:resourceGroup,environmentId:properties.managedEnvironmentId,fqdn:properties.configuration.ingress.fqdn}" \
  -o table
```

Inspect the current runtime environment variables:

```bash
az containerapp show \
  --name ca-autoflow-staging-backend \
  --resource-group rg-autoflow-staging \
  --query "properties.template.containers[0].env" \
  -o table
```

Inspect the managed environment VNet integration:

```bash
az containerapp env show \
  --name cae-autoflow-staging \
  --resource-group rg-autoflow-staging \
  --query "{defaultDomain:properties.defaultDomain,vnetConfiguration:properties.vnetConfiguration}" \
  -o json
```

Inspect the staging VNet used by Container Apps:

```bash
az network vnet show \
  --name vnet-autoflow-staging \
  --resource-group rg-autoflow-staging \
  --query "{dhcpOptions:dhcpOptions,subnets:[subnets[].{name:name,addressPrefix:addressPrefix,delegations:delegations[].serviceName}]}" \
  -o json
```

## Verify the actual staging Key Vault

List Key Vaults and confirm the live staging URI:

```bash
az keyvault list \
  --query "[].{name:name,resourceGroup:resourceGroup,vaultUri:properties.vaultUri,publicNetworkAccess:properties.publicNetworkAccess}" \
  -o table
```

Inspect the staging Key Vault directly:

```bash
az keyvault show \
  --name kv-autoflow-staging \
  --resource-group rg-autoflow-staging \
  --query "{vaultUri:properties.vaultUri,publicNetworkAccess:properties.publicNetworkAccess,privateEndpointConnections:properties.privateEndpointConnections}" \
  -o json
```

If `AZURE_KEY_VAULT_URI` on the Container App points to a different vault name, the backend is using a stale runtime value and the deploy workflow must overwrite it.

## Verify private DNS only when the vault is private

If the staging Key Vault uses a private endpoint, confirm that the Container Apps VNet is linked to the correct zone:

```bash
az network private-dns zone list \
  --query "[?name=='privatelink.vaultcore.azure.net'].{name:name,resourceGroup:resourceGroup}" \
  -o table
```

Then inspect links on the zone resource group:

```bash
az network private-dns link vnet list \
  --resource-group <zone-resource-group> \
  --zone-name privatelink.vaultcore.azure.net \
  -o table
```

The VNet running the Container Apps environment must appear in that link list.

## Recovery actions

1. Run the staging deploy workflow after updating the workflow variables or secret files.
2. Ensure the workflow resolves and writes the correct `AZURE_KEY_VAULT_URI` into the Container App revision.
3. If Key Vault remains unavailable, populate `AZURE_BACKEND_ENV_STAGING_RUNTIME` with direct runtime overrides such as:

```env
DATABASE_URL=<staging database url>
REDIS_URL=<staging redis url>
CONNECTOR_CREDENTIAL_ENCRYPTION_KEY=<staging connector key>
AZURE_CIAM_CLIENT_SECRET=<staging ciam client secret>
STRIPE_SECRET_KEY=<staging stripe secret key>
STRIPE_WEBHOOK_SECRET=<staging stripe webhook secret>
```

4. Re-run the staging deploy workflow so those values are stamped directly into the Container App revision.
5. Confirm the latest revision becomes ready and the `/health` smoke test passes.
