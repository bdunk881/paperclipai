variable "env"               { type = string }
variable "vpc_id"            { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "alb_sg_id"         { type = string }
variable "backend_image"     { type = string }
variable "frontend_image"    { type = string }
variable "task_cpu"          { type = number; default = 512 }
variable "task_memory"       { type = number; default = 1024 }
variable "min_capacity"      { type = number; default = 1 }
variable "max_capacity"      { type = number; default = 5 }
variable "backend_tg_arn"    { type = string }
variable "frontend_tg_arn"   { type = string }
variable "secrets_arn"       { type = string }

locals {
  is_prod = var.env == "production"
}

resource "aws_ecs_cluster" "main" {
  name = "autoflow-${var.env}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = local.is_prod ? "FARGATE" : "FARGATE_SPOT"
    weight            = 1
  }
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/autoflow-${var.env}/backend"
  retention_in_days = local.is_prod ? 90 : 14
}

resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/ecs/autoflow-${var.env}/frontend"
  retention_in_days = local.is_prod ? 90 : 14
}

data "aws_iam_role" "ecs_task_exec" {
  name = "ecsTaskExecutionRole"
}

resource "aws_iam_role" "task_role" {
  name = "autoflow-${var.env}-task-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "task_secrets" {
  name = "allow-secrets-manager"
  role = aws_iam_role.task_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [var.secrets_arn]
    }]
  })
}

resource "aws_security_group" "ecs_tasks" {
  name   = "autoflow-${var.env}-ecs-tasks"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [var.alb_sg_id]
  }
  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [var.alb_sg_id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "autoflow-backend-${var.env}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = data.aws_iam_role.ecs_task_exec.arn
  task_role_arn            = aws_iam_role.task_role.arn

  container_definitions = jsonencode([{
    name  = "backend"
    image = var.backend_image
    portMappings = [{ containerPort = 8000, protocol = "tcp" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.backend.name
        awslogs-region        = "us-east-1"
        awslogs-stream-prefix = "ecs"
      }
    }
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${var.secrets_arn}:DATABASE_URL::" },
      { name = "SECRET_KEY",   valueFrom = "${var.secrets_arn}:SECRET_KEY::" },
      { name = "REDIS_URL",    valueFrom = "${var.secrets_arn}:REDIS_URL::" }
    ]
    environment = [
      { name = "ENV", value = var.env }
    ]
    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 30
    }
  }])
}

resource "aws_ecs_task_definition" "frontend" {
  family                   = "autoflow-frontend-${var.env}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = data.aws_iam_role.ecs_task_exec.arn

  container_definitions = jsonencode([{
    name  = "frontend"
    image = var.frontend_image
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.frontend.name
        awslogs-region        = "us-east-1"
        awslogs-stream-prefix = "ecs"
      }
    }
    environment = [
      { name = "NEXT_PUBLIC_API_URL", value = "https://${var.env == "production" ? "autoflow.app" : "staging.autoflow.app"}/api" }
    ]
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:3000/api/health || exit 1"]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 30
    }
  }])
}

resource "aws_ecs_service" "backend" {
  name                   = "autoflow-backend-${var.env}"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.backend.arn
  desired_count          = var.min_capacity
  enable_execute_command = true

  capacity_provider_strategy {
    capacity_provider = local.is_prod ? "FARGATE" : "FARGATE_SPOT"
    weight            = 1
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.backend_tg_arn
    container_name   = "backend"
    container_port   = 8000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller {
    type = "ECS"
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

resource "aws_ecs_service" "frontend" {
  name                   = "autoflow-frontend-${var.env}"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.frontend.arn
  desired_count          = var.min_capacity

  capacity_provider_strategy {
    capacity_provider = local.is_prod ? "FARGATE" : "FARGATE_SPOT"
    weight            = 1
  }

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.frontend_tg_arn
    container_name   = "frontend"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

# Autoscaling
resource "aws_appautoscaling_target" "backend" {
  max_capacity       = var.max_capacity
  min_capacity       = var.min_capacity
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "autoflow-${var.env}-backend-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

output "cluster_name"     { value = aws_ecs_cluster.main.name }
output "backend_service"  { value = aws_ecs_service.backend.name }
output "frontend_service" { value = aws_ecs_service.frontend.name }
