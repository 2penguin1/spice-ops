# Single stage: the app runs TypeScript directly through tsx, so there is no
# build output to copy between stages.
FROM node:24-alpine

WORKDIR /app

# Copy manifests first so `npm ci` is only re-run when dependencies change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# node:24-alpine ships an unprivileged `node` user. Running as root in a
# container is a needless escalation if the process is ever compromised.
USER node

ENV NODE_ENV=production
EXPOSE 3000

# node is PID 1 and receives SIGTERM directly. Going through `npm start` would
# put npm at PID 1, which does not reliably forward signals to its child, so
# the graceful shutdown in src/index.ts would never run.
CMD ["node", "--import", "tsx", "src/index.ts"]
