# syntax=docker/dockerfile:1
#
# Production image for the Foghaven Colyseus server. Built from the repo ROOT
# (the monorepo's workspaces + lockfile live here), which is also how Railway
# builds it — see railway.json and docs/DEPLOYMENT.md.
#
# The server runs its TypeScript directly with `tsx` (matching the `start`
# script) rather than emitting JS: `@foghaven/shared` is itself consumed as
# source (its package `main` is `./index.ts`), so there is no build artifact to
# produce — only the Prisma client needs generating. `tsx` and the Prisma CLI
# are devDependencies, so the runtime keeps the full dependency install.
#
# npm hoists most deps to the root node_modules but keeps a few (notably
# `prisma`/`@prisma/client`) nested under `server/node_modules`. So the whole
# install is built in ONE stage and copied wholesale — selectively copying only
# the root node_modules would silently drop those nested packages. Binaries are
# invoked by explicit path for the same reason: `npx prisma` from the root
# can't see the nested CLI and would download a mismatched version.

FROM node:20-alpine AS build
WORKDIR /app
# Manifests first so `npm ci` is cached until a dependency actually changes.
# All three workspace manifests are required — the lockfile references them.
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci
# Source (node_modules is excluded via .dockerignore, so the install stands).
COPY . .
# Generate the Prisma client (into server/node_modules/@prisma/client). Explicit
# binary path — the pinned CLI is nested, not hoisted.
RUN server/node_modules/.bin/prisma generate --schema server/prisma/schema.prisma

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# tini reaps zombies and forwards SIGTERM cleanly to the server, which is what
# lets Colyseus run its graceful shutdown on a Railway redeploy.
RUN apk add --no-cache tini
# The entire built tree, including root AND nested workspace node_modules.
COPY --from=build /app ./
# Railway injects $PORT; 2567 is only the local default the server falls back to.
EXPOSE 2567
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "server/scripts/start-prod.sh"]
