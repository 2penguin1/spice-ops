# Build the static site, then serve it from nginx. The build tools are left
# behind in the first stage; the image that ships is nginx and a folder of files.

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

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
