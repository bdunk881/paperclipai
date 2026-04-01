terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket         = "autoflow-terraform-state"
    key            = "staging/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "autoflow-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = {
      Project     = "autoflow"
      Environment = "staging"
      ManagedBy   = "terraform"
    }
  }
}

module "networking" {
  source   = "../../modules/networking"
  env      = "staging"
  vpc_cidr = "10.10.0.0/16"
}

module "ecr" {
  source = "../../modules/ecr"
  env    = "staging"
}

module "alb" {
  source            = "../../modules/alb"
  env               = "staging"
  vpc_id            = module.networking.vpc_id
  public_subnet_ids = module.networking.public_subnet_ids
  certificate_arn   = var.certificate_arn
}

module "ecs" {
  source             = "../../modules/ecs"
  env                = "staging"
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  alb_sg_id          = module.alb.alb_sg_id
  backend_image      = "${module.ecr.repository_urls["backend"]}:latest"
  frontend_image     = "${module.ecr.repository_urls["frontend"]}:latest"
  task_cpu           = 256
  task_memory        = 512
  min_capacity       = 1
  max_capacity       = 3
  backend_tg_arn     = module.alb.backend_tg_arn
  frontend_tg_arn    = module.alb.frontend_tg_arn
  secrets_arn        = aws_secretsmanager_secret.app.arn
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "autoflow/staging/app"
  recovery_window_in_days = 0  # allow immediate deletion in staging
}

# Budget alarm
resource "aws_budgets_budget" "staging" {
  name         = "autoflow-staging-monthly"
  budget_type  = "COST"
  limit_amount = "150"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.ops_email]
  }
}

variable "certificate_arn" { type = string }
variable "ops_email"        { type = string }

output "alb_dns"     { value = module.alb.alb_dns_name }
output "cluster"     { value = module.ecs.cluster_name }
output "ecr_urls"    { value = module.ecr.repository_urls }
