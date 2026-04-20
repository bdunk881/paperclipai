# Cloudflare R2 + CDN Terraform

## Resources

- `cloudflare_r2_bucket` for brand assets
- `cloudflare_r2_custom_domain` for `cdn.helloautoflow.com`
- optional `cloudflare_dns_record` for `cdn` CNAME

## Usage

```bash
terraform init
terraform apply \
  -var="cloudflare_api_token=$CLOUDFLARE_API_TOKEN" \
  -var="cloudflare_account_id=$CLOUDFLARE_ACCOUNT_ID" \
  -var="cloudflare_zone_id=$CLOUDFLARE_ZONE_ID" \
  -var="bucket_name=autoflow-brand-assets" \
  -var="custom_domain=cdn.helloautoflow.com"
```

## Required token scopes

- `Account` -> `R2:Edit`
- `Zone` -> `DNS:Edit`
