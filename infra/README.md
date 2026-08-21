# Deploying

The whole system on one free-tier EC2 instance: Postgres, Redis, the API and
Caddy, as containers on a single machine.

That is a deliberate trade. One box means one failure domain and no horizontal
scale. In exchange it costs nothing, and when something breaks there is exactly
one place to look. A managed database, a managed cache, containers behind a
load balancer and a CDN in front of the frontend is the architecture this would
grow into, and it starts at roughly $35 a month — most of it the load balancer.

## First deploy

You need Terraform, the AWS CLI with working credentials, and a domain you can
add a DNS record to.

```bash
cp terraform.tfvars.example terraform.tfvars   # region, domain, ssh_key_name
terraform init
```

The address has to exist before DNS can point at it, and DNS has to resolve
before a certificate can be issued — the issuer proves you control the name by
fetching something from it. So the address comes first:

```bash
terraform apply -target="aws_eip.app"
#   → elastic_ip = "13.x.x.x"
```

Add an `A` record for your domain pointing at that address, and wait for it to
resolve:

```bash
nslookup your-domain.example 8.8.8.8
```

Then build the rest:

```bash
terraform apply
```

First boot takes 5–10 minutes. The instance installs Docker, clones the
repository and builds both images itself, so nothing has to be pushed to a
registry.

## What it creates

One `t3.micro`, one security group, one elastic IP, and a generated signing
secret and database password that no person ever sees.

## How the pieces fit

- **Caddy** serves the built frontend and proxies `/api` to the API, so both
  are on one origin. There is no CORS to configure, and the event stream is not
  a cross-site request. Given a domain it obtains and renews the certificate
  itself and redirects HTTP to HTTPS.
- **Postgres** initialises itself from `database/schema.sql` and
  `database/seed.sql`, which it runs once when its data directory is empty.
  Production therefore ships no migration tool.
- **Redis** is present, so the cache and the Redis-backed event bus are both
  live rather than falling back to their in-process equivalents.
- **systemd** brings the stack back after a reboot.
- **Swap** is added at boot because a `t3.micro` has 1 GB of RAM and the
  frontend build peaks above it. Without swap the build is killed.

## Updating a running deployment

Nothing deploys automatically. After pushing:

```bash
ssh ec2-user@<ip>
cd /opt/spice
sudo git pull
sudo docker compose -f docker-compose.prod.yml up -d --build
```

Roughly four minutes, most of it the frontend build. Add `web` or `api` to the
end to rebuild only one of them.

## When it does not come up

```bash
sudo tail -f /var/log/cloud-init-output.log            # the boot script
cd /opt/spice
sudo docker compose -f docker-compose.prod.yml ps      # what is running
sudo docker compose -f docker-compose.prod.yml logs web --tail 50   # certificates
sudo docker compose -f docker-compose.prod.yml logs api --tail 50   # requests
```

A certificate that never arrives is almost always DNS: check the name resolves
to this machine from a public resolver, not just your own.

## Secrets

`terraform.tfvars` and the state file hold real values and are gitignored. The
state file in particular contains the generated signing secret in plain text,
so it stays local.

Optional values like an AI key can be set directly in `/opt/spice/.env` and
picked up with `docker compose up -d api`. Putting them in `terraform.tfvars`
instead would change the boot script, and `user_data_replace_on_change` means
that replaces the whole machine — including the database — to add one variable.

## Shutting it down

```bash
terraform destroy
```

Removes everything, including the database volume and the address. An elastic
IP that is allocated but not attached to a running instance is billed by the
hour, so a half-finished deploy left overnight does cost something.
