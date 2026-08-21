# Build the static site, then serve it from Caddy. The build tools are left
# behind in the first stage; the image that ships is one binary and a folder
# of files.
#
# Caddy rather than nginx because it obtains and renews the TLS certificate
# itself. The alternative is nginx plus certbot plus a renewal timer, which is
# three moving parts to do what this does with a domain name.

FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
# --include=dev because vite and typescript are devDependencies and this stage
# is the only place they are needed.
RUN npm ci --include=dev

COPY . .

# Baked in at build time, not read at runtime: Vite inlines it into the bundle.
# "/api" keeps the browser on one origin, so there is no CORS to configure and
# the event stream is not a cross-site request.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

EXPOSE 80 443
