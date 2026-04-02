variable "prefix" { type = string }
variable "environment" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "aks_cluster_id" { type = string }
variable "alert_email" { type = string }
variable "tags" { type = map(string) }

variable "app_hostname" {
  description = "Hostname of the deployed app for availability tests (e.g. api.helloautoflow.com)"
  type        = string
  default     = "api.helloautoflow.com"
}
