# syntax=docker/dockerfile:1
#
# Builds ONE container that runs the Express API (artifacts/api-server) and
# also serves the built frontend (artifacts/shareholder-management) as static
# files, so the whole app deploys as a single Azure App Service (Web App for
# Containers) or Azure Container Apps instance — matching how Replit itself
# deploys this app's two services (see artifacts/*/.replit-artifact/artifact.toml).
#
# artifacts/mockup-sandbox is a Replit-only dev/preview tool: it has no
# [services.production] section in its own .replit-artifact/artifact.toml,
# meaning Replit itself never builds or deploys it in production —
# intentionally not built or served here either.
#
# The root-level src/repl_nix_workspace Python package (declared in
# pyproject.toml) is an unused Replit-template stub — nothing in this app
# imports or runs it — so it is not installed or copied into this image.
#
# See AZURE_DEPLOYMENT.md for the required Azure resources and environment
# variables (DATABASE_PROVIDER=azure + AZURE_PG_*, OBJECT_STORAGE_PROVIDER=
# sharepoint + SHAREPOINT_*, CLIENT_ID/CLIENT_SECRET/TENANT_ID,
# AUTH_ALLOWED_HOSTS, SESSION_SECRET, etc.) — none of those are baked into the
# image; they're supplied at deploy time as App Settings / Container Apps
# secrets.
#
# This is a single-stage build (not multi-stage). pnpm workspaces hoist
# dependencies via symlinks into a content-addressable store, which is fragile
# to split across build/runtime stages with a plain COPY. Building and
# running from the same image is a bit larger but reliable.

FROM node:24-bookworm-slim

WORKDIR /repo

RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/api-server/package.json artifacts/api-server/package.json
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/package.json
COPY artifacts/shareholder-management/package.json artifacts/shareholder-management/package.json
COPY lib/api-client-react/package.json lib/api-client-react/package.json
COPY lib/api-spec/package.json lib/api-spec/package.json
COPY lib/api-zod/package.json lib/api-zod/package.json
COPY lib/db/package.json lib/db/package.json
COPY lib/replit-auth-web/package.json lib/replit-auth-web/package.json
COPY scripts/package.json scripts/package.json

RUN pnpm install --frozen-lockfile

COPY . .

ENV PORT=24972
ENV BASE_PATH=/
RUN pnpm --filter @workspace/shareholder-management run build

RUN pnpm run typecheck:libs
RUN pnpm --filter @workspace/api-server run build

# --- Runtime ---------------------------------------------------------------
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_DIR=/repo/artifacts/shareholder-management/dist/public

EXPOSE 8080

WORKDIR /repo/artifacts/api-server
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
