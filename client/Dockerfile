# syntax=docker/dockerfile:1
#
# Static hosting for the Foghaven web client, as a Railway service (built from
# the repo ROOT, same as the server image). This is the "host it on Railway
# too" option; the lower-friction path is Netlify/Vercel — see client/netlify.toml
# and docs/DEPLOYMENT.md.
#
# VITE_SERVER_URL is a BUILD-time value (Vite inlines import.meta.env at build),
# so it is passed as a build arg pointing at the deployed server's public
# domain, e.g. --build-arg VITE_SERVER_URL=wss://foghaven-server.up.railway.app

FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_SERVER_URL
ARG VITE_AUTH_URL
ARG VITE_SENTRY_DSN
ENV VITE_SERVER_URL=$VITE_SERVER_URL
ENV VITE_AUTH_URL=$VITE_AUTH_URL
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
# Manifests first for cached installs (lockfile references all workspaces).
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci
COPY . .
RUN npm run build -w client

# Caddy serves the built SPA with a history-API fallback to index.html.
FROM caddy:2-alpine AS runtime
COPY client/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/client/dist /srv
