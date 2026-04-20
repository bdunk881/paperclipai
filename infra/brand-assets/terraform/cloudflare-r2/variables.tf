variable "cloudflare_api_token" {
  description = "Cloudflare API token with R2 and DNS edit permissions"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for helloautoflow.com"
  type        = string
}

variable "bucket_name" {
  description = "R2 bucket name"
  type        = string
  default     = "autoflow-brand-assets"
}

variable "custom_domain" {
  description = "Custom CDN domain"
  type        = string
  default     = "cdn.helloautoflow.com"
}

variable "create_dns_record" {
  description = "Whether to create the DNS CNAME record"
  type        = bool
  default     = true
}
