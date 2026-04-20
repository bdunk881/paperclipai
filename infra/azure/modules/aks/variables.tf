variable "prefix" { type = string }
variable "environment" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "aks_subnet_id" { type = string }
variable "acr_id" { type = string }
variable "kubernetes_version" { type = string }
variable "node_count" { type = number }
variable "node_vm_size" { type = string }
variable "min_node_count" { type = number }
variable "max_node_count" { type = number }
variable "tags" { type = map(string) }

variable "api_server_authorized_ips" {
  description = "CIDR blocks allowed to reach the Kubernetes API server. Must not be empty in production."
  type        = list(string)
}
