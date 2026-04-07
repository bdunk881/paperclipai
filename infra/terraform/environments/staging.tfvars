environment = "staging"
location    = "eastus2"
app_name    = "autoflow"
github_repo = "bdunk881/paperclipai"

# Container images — overridden by CI with the actual SHA tag
backend_image  = "ghcr.io/bdunk881/paperclipai-backend:latest"
frontend_image = "ghcr.io/bdunk881/paperclipai-frontend:latest"

# Networking
vnet_address_space            = "10.100.0.0/16"
container_apps_subnet_cidr    = "10.100.0.0/21"
private_endpoints_subnet_cidr = "10.100.8.0/24"

# PostgreSQL — small SKU for staging
postgres_sku          = "B_Standard_B2ms"
postgres_storage_mb   = 32768
postgres_version      = "16"
postgres_admin_username = "autoflowadmin"

# Redis — Basic C1 for staging
redis_sku      = "Basic"
redis_family   = "C"
redis_capacity = 1

# Storage — LRS sufficient for staging
storage_replication = "LRS"

# Container App — minimal resources for staging
backend_min_replicas = 1
backend_max_replicas = 3
backend_cpu          = 0.5
backend_memory       = "1Gi"
backend_port         = 8000
