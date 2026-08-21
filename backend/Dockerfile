# Single stage: tsx runs the TypeScript directly, so there is nothing to copy
# between stages.
FROM node:24-alpine

WORKDIR /app

# Manifests first, so npm ci only re-runs when dependencies change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Unprivileged user; nothing here needs root.
USER node

ENV NODE_ENV=production
EXPOSE 3000

# node as PID 1, so it receives SIGTERM directly. npm does not reliably forward
# signals, which would leave the shutdown handler unreachable.
CMD ["node", "--import", "tsx", "src/index.ts"]
