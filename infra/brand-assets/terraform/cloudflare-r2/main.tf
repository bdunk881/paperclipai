provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

locals {
  custom_domain_host = replace(var.custom_domain, ".helloautoflow.com", "")
}

resource "cloudflare_r2_bucket" "brand_assets" {
  account_id = var.cloudflare_account_id
  name       = var.bucket_name
}

resource "cloudflare_r2_custom_domain" "brand_cdn" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.brand_assets.name
  domain      = var.custom_domain
  enabled     = true
  zone_id     = var.cloudflare_zone_id
}

resource "cloudflare_dns_record" "cdn" {
  count   = var.create_dns_record ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = local.custom_domain_host
  type    = "CNAME"
  content = cloudflare_r2_custom_domain.brand_cdn.domain
  proxied = true
  ttl     = 1
}
