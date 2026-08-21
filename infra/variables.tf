variable "region" {
  description = "AWS region. Pick the one nearest whoever will be using it."
  type        = string
  default     = "ap-south-1" # Mumbai
}

variable "instance_type" {
  description = "Free tier is t3.micro or t2.micro for the first 12 months of a new account."
  type        = string
  default     = "t3.micro"
}

variable "repo_url" {
  description = "Public git URL the instance clones on first boot."
  type        = string
  default     = "https://github.com/2penguin1/spice-ops.git"
}

variable "ssh_key_name" {
  description = <<-EOT
    Name of an existing EC2 key pair, so you can SSH in and read logs.
    Leave empty to create the instance with no SSH access at all.
  EOT
  type        = string
  default     = ""
}

variable "ssh_cidr" {
  description = <<-EOT
    Who may reach port 22. Your own address, as "1.2.3.4/32".
    The default of 0.0.0.0/0 opens SSH to the internet, which is fine for a
    throwaway demo and wrong for anything else.
  EOT
  type        = string
  default     = "0.0.0.0/0"
}

variable "groq_api_key" {
  description = "Optional. Without it the dashboard shows every figure and hides the written summary."
  type        = string
  default     = ""
  sensitive   = true
}
