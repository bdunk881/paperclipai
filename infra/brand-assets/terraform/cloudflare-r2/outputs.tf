output "bucket_name" {
  value       = cloudflare_r2_bucket.brand_assets.name
  description = "Provisioned R2 bucket name"
}

output "cdn_domain" {
  value       = var.custom_domain
  description = "Custom CDN domain"
}
