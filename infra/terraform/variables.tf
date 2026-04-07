# ─── Core ─────────────────────────────────────────────────────────────────────

variable "environment" {
  description = "Deployment environment: staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}

variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "eastus2"
}

variable "app_name" {
  description = "Short application name used in resource names"
  type        = string
  default     = "autoflow"
}

# ─── Container image ──────────────────────────────────────────────────────────

variable "backend_image" {
  description = "Fully-qualified Docker image for the backend, e.g. ghcr.io/org/repo-backend:sha-abc123"
  type        = string
}

variable "frontend_image" {
  description = "Fully-qualified Docker image for the frontend/dashboard, e.g. ghcr.io/org/repo-frontend:sha-abc123"
  type        = string
  default     = ""
}

# ─── Networking ───────────────────────────────────────────────────────────────

variable "vnet_address_space" {
  description = "CIDR for the VNet"
  type        = string
  default     = "10.100.0.0/16"
}

variable "container_apps_subnet_cidr" {
  description = "Subnet CIDR delegated to Azure Container Apps environment (min /21)"
  type        = string
  default     = "10.100.0.0/21"
}

variable "private_endpoints_subnet_cidr" {
  description = "Subnet CIDR for private endpoints (database, cache)"
  type        = string
  default     = "10.100.8.0/24"
}

# ─── PostgreSQL ───────────────────────────────────────────────────────────────

variable "postgres_sku" {
  description = "PostgreSQL Flexible Server SKU name"
  type        = string
  default     = "B_Standard_B2ms"
}

variable "postgres_storage_mb" {
  description = "PostgreSQL storage size in MB"
  type        = number
  default     = 32768
}

variable "postgres_version" {
  description = "PostgreSQL major version"
  type        = string
  default     = "16"
}

variable "postgres_admin_username" {
  description = "PostgreSQL administrator login name"
  type        = string
  default     = "autoflowadmin"
  sensitive   = true
}

# ─── Redis ────────────────────────────────────────────────────────────────────

variable "redis_sku" {
  description = "Redis Cache SKU: Basic, Standard, or Premium"
  type        = string
  default     = "Basic"
}

variable "redis_family" {
  description = "Redis Cache family: C (Basic/Standard) or P (Premium)"
  type        = string
  default     = "C"
}

variable "redis_capacity" {
  description = "Redis Cache capacity (0=250MB, 1=1GB, 2=2.5GB, ...)"
  type        = number
  default     = 1
}

# ─── Storage ──────────────────────────────────────────────────────────────────

variable "storage_replication" {
  description = "Storage account replication type: LRS, GRS, ZRS, GZRS"
  type        = string
  default     = "LRS"
}

# ─── Container Apps ───────────────────────────────────────────────────────────

variable "backend_min_replicas" {
  description = "Minimum backend container replicas"
  type        = number
  default     = 1
}

variable "backend_max_replicas" {
  description = "Maximum backend container replicas"
  type        = number
  default     = 5
}

variable "backend_cpu" {
  description = "CPU cores for backend container (0.25, 0.5, 0.75, 1.0, ...)"
  type        = number
  default     = 0.5
}

variable "backend_memory" {
  description = "Memory for backend container (e.g. 1Gi)"
  type        = string
  default     = "1Gi"
}

variable "backend_port" {
  description = "Port the backend application listens on"
  type        = number
  default     = 8000
}

# ─── OIDC federation for GitHub Actions ──────────────────────────────────────

variable "github_repo" {
  description = "GitHub repo in org/repo format, e.g. bdunk881/paperclipai"
  type        = string
}
