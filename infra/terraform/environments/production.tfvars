environment = "production"
location    = "eastus2"
app_name    = "autoflow"
github_repo = "bdunk881/paperclipai"

# Container images — overridden by CI with the actual release tag
backend_image  = "ghcr.io/bdunk881/paperclipai-backend:latest"
frontend_image = "ghcr.io/bdunk881/paperclipai-frontend:latest"

# Networking — separate address space from staging to avoid conflicts
vnet_address_space            = "10.101.0.0/16"
container_apps_subnet_cidr    = "10.101.0.0/21"
private_endpoints_subnet_cidr = "10.101.8.0/24"

# PostgreSQL — General Purpose for production
postgres_sku          = "GP_Standard_D2s_v3"
postgres_storage_mb   = 65536
postgres_version      = "16"
postgres_admin_username = "autoflowadmin"

# Redis — Standard C1 for production (replication, failover)
redis_sku      = "Standard"
redis_family   = "C"
redis_capacity = 1

# Storage — GRS for production (geo-redundant)
storage_replication = "GRS"

# Container App — larger resources and more replicas for production
backend_min_replicas = 2
backend_max_replicas = 10
backend_cpu          = 1.0
backend_memory       = "2Gi"
backend_port         = 8000
