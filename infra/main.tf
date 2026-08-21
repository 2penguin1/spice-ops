/**
 * Spice Garden OMS on one EC2 instance.
 *
 * Everything — Postgres, Redis, the API and nginx — runs as containers on a
 * single free-tier machine. That is a deliberate trade: it is one box, so it
 * has one failure domain and no horizontal scale, and in exchange it costs
 * nothing and there is exactly one place to look when something breaks.
 *
 * The instance builds the app itself on first boot, so nothing has to be
 * pushed to a registry.
 */

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "spice-garden-oms"
      ManagedBy = "terraform"
    }
  }
}

# The default VPC every account already has. A purpose-built VPC would be three
# more resources for a single public instance that gains nothing from them.
data "aws_vpc" "default" {
  default = true
}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-kernel-6.1-x86_64"]
  }
}

# Written once, at apply time, and never seen by a person. Rotating it means
# tainting this resource and letting the instance rebuild.
resource "random_password" "jwt_secret" {
  length  = 48
  special = false
}

resource "random_password" "db_password" {
  length  = 24
  special = false
}

resource "aws_security_group" "app" {
  name_prefix = "spice-oms-"
  description = "Spice Garden OMS: public web, optional SSH"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "Web"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }

  # Outbound is open because the instance pulls images, clones the repo and
  # calls the AI provider. Postgres and Redis are never published: they are
  # reachable only over the compose network inside this machine.
  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.app.id]
  key_name               = var.ssh_key_name != "" ? var.ssh_key_name : null

  root_block_device {
    volume_size = 20 # Free tier allows 30 GB; images and build caches want room.
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = templatefile("${path.module}/user-data.sh", {
    repo_url     = var.repo_url
    jwt_secret   = random_password.jwt_secret.result
    db_password  = random_password.db_password.result
    groq_api_key = var.groq_api_key
  })

  # Replace the machine when the boot script changes, rather than leaving a
  # running instance that no longer matches what is written here.
  user_data_replace_on_change = true

  tags = { Name = "spice-oms" }
}
