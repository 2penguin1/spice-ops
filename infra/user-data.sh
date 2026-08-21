#!/bin/bash
# First boot: install Docker, fetch the app, build it, run it.
#
# Output goes to /var/log/cloud-init-output.log, which is the first place to
# look if the site does not come up.
set -euxo pipefail

dnf update -y
dnf install -y docker git

# t3.micro has 1 GB of RAM and the Vite build wants more than that at its peak.
# Swap is slower than memory and much faster than a build that gets killed.
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

systemctl enable --now docker
usermod -aG docker ec2-user

# Amazon Linux ships Docker without the compose plugin.
COMPOSE_VERSION=v2.29.7
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL \
  "https://github.com/docker/compose/releases/download/$${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

git clone --depth 1 ${repo_url} /opt/spice
cd /opt/spice

# The public address is only known once the instance exists, so it is read from
# instance metadata rather than passed in. IMDSv2 needs a token first.
TOKEN=$(curl -fsSL -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
PUBLIC_IP=$(curl -fsSL -H "X-aws-ec2-metadata-token: $${TOKEN}" \
  "http://169.254.169.254/latest/meta-data/public-ipv4")

DOMAIN="${domain}"
if [ -n "$${DOMAIN}" ]; then
  # A bare hostname tells Caddy to obtain a certificate for it and to redirect
  # HTTP to HTTPS. It keeps retrying, so DNS that is still propagating delays
  # the certificate rather than failing the boot.
  SITE_ADDRESS="$${DOMAIN}"
  PUBLIC_URL="https://$${DOMAIN}"
else
  SITE_ADDRESS=":80"
  PUBLIC_URL="http://$${PUBLIC_IP}"
fi

# 0600 because it holds the signing secret and the database password.
umask 077
cat >/opt/spice/.env <<EOF
POSTGRES_PASSWORD=${db_password}
JWT_SECRET=${jwt_secret}
GROQ_API_KEY=${groq_api_key}
SITE_ADDRESS=$${SITE_ADDRESS}
PUBLIC_URL=$${PUBLIC_URL}
EOF

docker compose -f docker-compose.prod.yml up -d --build

# Bring the stack back up after a reboot without anyone logging in.
cat >/etc/systemd/system/spice.service <<'EOF'
[Unit]
Description=Spice Garden OMS
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/spice
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml down

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable spice.service

echo "Spice Garden OMS is up on $${PUBLIC_URL}"
