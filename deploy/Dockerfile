# SL Politics — backend runtime image, shared by the API and the sync worker.
#
# ONE image, TWO commands. server/api/server.ts and server/scheduler/worker.ts
# are two entry points into the same codebase with the same dependencies —
# building two separate images would mean building the same `npm ci` twice
# and keeping two Dockerfiles in step with every dependency change. The
# command that decides which process runs is supplied by docker-compose.yml
# (or an equivalent), not baked in here.
#
# NO BUILD STEP. Node 24 runs this project's TypeScript directly (strip-only
# mode — see package.json's "engines" and how every server/*.ts file is
# invoked with a bare `node`, never `tsc` then `node`). There is nothing here
# for a multi-stage build to discard, because nothing is compiled.
#
# NOT the frontend. The static site (dist/) is built once and served from a
# CDN or deploy/nginx.conf — it does not run as a container. See
# deploy/README.md for why these are separate deployables.

# Pinned by digest, not just the "24-slim" tag (M-5, docs/security-audit-
# followup-2026-09-04.md, SECURITY--SL Politics.md §20/§16): a tag can move
# to a different image tomorrow with no diff in this file; a digest cannot.
# Re-pin deliberately (`docker pull node:24-slim` then copy the new digest
# it reports) when there is a reason to move — a security patch, not on a
# schedule.
FROM node:24-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

WORKDIR /app

# Dependencies first, so an ordinary code change does not invalidate the
# `npm ci` layer and force a full reinstall on every rebuild.
#
# --ignore-scripts: the three PRODUCTION dependencies (pg, react, react-dom)
# need no install script, and --omit=dev already keeps the two dev-only
# packages that DO have one (esbuild, fsevents — checked via package-lock.json's
# `hasInstallScript` flags) out of this image entirely. --ignore-scripts is
# therefore defense-in-depth for whatever gets added later, not a fix for an
# exploitable path today: a compromised or typo-squatted future dependency's
# postinstall script is a common way malicious npm packages execute code at
# build time, and this closes that door regardless of dev/prod classification.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY server ./server
COPY src ./src

# JAVORA_DB's directory (see .env.production.example) — created here so a
# fresh container has somewhere to write before the app itself creates it,
# and so the volume mount below has a real path to attach to. Owned by the
# unprivileged `node` user (built into the base image, uid 1000) below, since
# that is who needs to write the SQLite file once the process drops root.
RUN mkdir -p /var/lib/javora && chown -R node:node /app /var/lib/javora

# Never run as root: a bug in either entry point (or in a future dependency)
# then only gets the privileges of this account, not the container's root —
# which on a default Docker install is one namespace away from host root.
USER node

# Overridden per-service in docker-compose.yml: `node server/api/server.ts`
# or `node server/scheduler/worker.ts`. This default makes `docker run` with
# no command do something sensible rather than nothing.
CMD ["node", "server/api/server.ts"]
