#!/bin/sh
# Production start: apply any pending database migrations, THEN open the socket.
# Running migrations here (once per release, before listening) rather than at
# build time is deliberate — the database is only reachable at runtime, and a
# release must never begin serving against an un-migrated schema.
#
# Run from the repo root (where the Dockerfile's WORKDIR and CMD put us).
set -e

echo "Applying database migrations…"
# Explicit binary path — the pinned Prisma CLI is nested under
# server/node_modules (not hoisted), so `npx prisma` from the repo root would
# download a mismatched version instead of using it.
server/node_modules/.bin/prisma migrate deploy --schema server/prisma/schema.prisma

echo "Starting Foghaven server…"
# Start from the server directory so tsx picks up server/tsconfig.json — its
# `experimentalDecorators` is what @colyseus/schema's field decorators need
# (this mirrors how `npm run dev -w server` runs, with cwd = server/). tsx
# itself is hoisted to the repo-root node_modules, hence ../node_modules.
# exec so tsx replaces this shell and receives SIGTERM directly (via tini),
# which triggers Colyseus's graceful shutdown on redeploy.
cd server
exec ../node_modules/.bin/tsx src/index.ts
