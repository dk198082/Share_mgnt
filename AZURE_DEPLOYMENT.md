# Deploying Shareholder Management to Azure

This app already has a mature, previously-built Azure migration story —
database cutover, SharePoint file storage, and schema-migration tooling are
all documented under `docs/`:

- [`docs/azure-entra-readiness.md`](docs/azure-entra-readiness.md) — the Entra
  sign-in model (read this first; it explains why access is tenant-wide).
- [`docs/azure-data-cutover.md`](docs/azure-data-cutover.md) — the database +
  file-storage cutover history and **confirms the published configuration**.
- [`docs/sharepoint-file-storage.md`](docs/sharepoint-file-storage.md) — how
  `OBJECT_STORAGE_PROVIDER=sharepoint` is configured and used.
- [`docs/migrated-file-access-verification.md`](docs/migrated-file-access-verification.md)
  — the verification record for the SharePoint cutover.
- [`docs/azure-schema-migrations.md`](docs/azure-schema-migrations.md) — how
  schema changes are authored, reviewed and applied against Azure Postgres
  (**not** `pnpm push`, which is Preview-only).

This document doesn't repeat those — it covers what's new this round: the
code change needed to actually run this app's **container** on Azure, and a
consolidated environment-variable reference for the App Service/Container
Apps deployment itself.

The app is a pnpm workspace with two deployable pieces:

- `artifacts/api-server` — Express 5 API (Microsoft Entra ID sign-in via
  `openid-client`, Drizzle-backed sessions, SSN encryption).
- `artifacts/shareholder-management` — the Vite/React frontend.

They ship as **one container**: the API server now also serves the built
frontend as static files (previously it didn't serve any frontend at all —
see below), so the whole app runs as a single Azure App Service (Web App for
Containers) or Container Apps instance on one origin — matching how Replit
itself deploys this app's two services per
`artifacts/*/.replit-artifact/artifact.toml`.

`artifacts/mockup-sandbox` is a Replit-only dev/preview tool — it has no
`[services.production]` section in its own `artifact.toml`, meaning Replit
itself never builds or deploys it in production. Not built or served here
either.

---

## ⚠️ Most important change this round: sign-in was hardcoded to Replit hosts

**`artifacts/api-server/src/routes/auth.ts`** — the `origin()` helper used by
`/api/login`, `/api/auth/callback`, and `/api/logout` only ever accepted a
request `Host` ending in `.replit.dev` or `.replit.app`; every other host
threw `"Sign-in is only available on the configured Replit app domains."`
**This would have broken every sign-in attempt on Azure** — an
`*.azurewebsites.net` hostname, or any custom domain, would never pass that
check.

Fixed by adding an explicit, configurable allowlist for non-Replit hosts:

```ts
const extraAllowedHosts = new Set(
  (process.env.AUTH_ALLOWED_HOSTS ?? "")
    .split(",").map(host => host.trim().toLowerCase()).filter(Boolean),
);
function isAllowedAuthHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower.endsWith(".replit.dev") || lower.endsWith(".replit.app") || extraAllowedHosts.has(lower);
}
```

`*.replit.dev` / `*.replit.app` are still always trusted (harmless to keep,
and lets Preview keep working unchanged). Set the new env var below to add
your Azure hostname(s).

| Variable | Notes |
|---|---|
| `AUTH_ALLOWED_HOSTS` | **new, required for Azure** — comma-separated list of exact hostnames (no scheme) this app is allowed to build sign-in redirect URLs for, e.g. `shareholder-management.azurewebsites.net` or `shareholder-management.azurewebsites.net,shareholders.yourcompany.com` for a custom domain too. |

I verified the matching logic directly (it's a small pure function with no
network dependency) — `.replit.dev`/`.replit.app` suffixes, an exact
`AUTH_ALLOWED_HOSTS` entry, and case-insensitivity all behave as expected,
and an unlisted host is rejected. I could **not** exercise the live
`/api/login` → Microsoft redirect itself in this sandbox, because it has no
outbound network access to `login.microsoftonline.com` (the sandbox's
network allowlist doesn't include it) — that part needs testing against your
real Entra tenant after deploying. The host-allowlist check itself runs
before any network call in `/api/logout`, and I confirmed via the live boot
test that requests reach past it into the app's normal error handling rather
than short-circuiting.

Register the exact callback URL for whichever host(s) you list, e.g.:

```text
https://shareholder-management.azurewebsites.net/api/auth/callback
```

---

## New changes made this round

### 1. `artifacts/api-server/src/routes/auth.ts` — Azure hostname allowlist

See above. This is the change that actually makes sign-in work on Azure.

### 2. `artifacts/api-server/src/app.ts` — serve the frontend + `trust proxy`

- Added `app.set("trust proxy", 1)` — not present before. Azure App
  Service/Container Apps terminates TLS at a reverse proxy in front of the
  container and forwards plain HTTP; without this, Express would think every
  request was insecure, and the `secure: true` cookies this app sets
  (session cookie, PKCE flow cookies) would silently fail to stick in the
  browser.
- Added a `STATIC_DIR`-gated static-file + SPA-fallback block (after the
  `/api` routes), matching the pattern used elsewhere in this app family.
  Unset in local dev; set by the Dockerfile below in production.
- Added an explicit `/api` catch-all returning `404 {"error":"Not found"}`,
  placed **before** the new static/SPA-fallback block. Without it, an
  unknown `/api/*` path would fall through past the mounted router (which
  has no 404 of its own) into the new SPA fallback and wrongly return `200`
  with `index.html` instead of a 404 — I caught this in the live boot test
  below.

### 3. `Dockerfile`, `.dockerignore` — **new files**

Single-stage build: installs the workspace, builds the frontend
(`@workspace/shareholder-management`, `PORT=24972 BASE_PATH=/` matching its
`artifact.toml`), builds the API server, and runs
`node --enable-source-maps ./dist/index.mjs` on port 8080.
`mockup-sandbox` is excluded from the build (its `package.json` is still
copied so `pnpm install` can resolve the workspace) — see the file header
comment for why.

### 4. `.gitignore` — added `.config/`

No application logic was changed here.

---

## Required environment variables

### Microsoft Entra ID (sign-in)

| Variable | Notes |
|---|---|
| `CLIENT_ID` | Entra App Registration's Application (client) ID. **Validated at first use** — the process won't crash at boot, but every sign-in attempt will fail until this is set. |
| `CLIENT_SECRET` | Entra App Registration client secret. |
| `TENANT_ID` | Entra tenant ID. Tokens from any other tenant are rejected even if otherwise valid. |
| `AUTH_ALLOWED_HOSTS` | **New this round, see above.** Comma-separated exact hostnames this app will build redirect URLs for. |

Per `docs/azure-entra-readiness.md`: any successfully authenticated account
in the configured tenant gets the same application access — there's no
separate role/allowlist check, and (per that doc) this is intentional for
now. The app requests `openid profile email offline_access` only; it does
not call Microsoft Graph for sign-in.

### Database

| Variable | Notes |
|---|---|
| `DATABASE_PROVIDER` | Set to `azure` in production. Confirmed via `.replit`'s `[userenv.production]` block — this is already the live published setting, not a new recommendation. |
| `AZURE_PG_HOST` / `AZURE_PG_PORT` / `AZURE_PG_DATABASE` | Connection coordinates. |
| `AZURE_PG_SP_USER` | DB user (service principal or regular Postgres role). |
| `AZURE_PG_PASSWORD` | |
| `AZURE_PG_SCHEMA` | Must be a valid identifier; set directly as the connection's `search_path`, so there's no drift between "the schema `pnpm push` writes to" and "the schema the app reads from" the way some sibling apps have — `pnpm push` is Preview-only here (see `docs/azure-schema-migrations.md`) and Azure schema changes go through the separate `azure:migrations:apply` / `azure:schema:check` tooling in `lib/db`, which never touches `DATABASE_URL` at all. |
| `AZURE_PG_SSLMODE` | Must not be `disable` — the app throws at startup if it is. |

`lib/db/src/index.ts` validates all of these are present and rejects an
invalid port, schema name, or `disable` SSL mode before opening a
connection — a genuinely cleaner pattern than some sibling apps in this
family, where `pnpm push`'s `DATABASE_URL` and the runtime `AZURE_PG_*` pool
can disagree about which schema is authoritative. That risk doesn't exist
here.

**Before first deploy**, follow `docs/azure-schema-migrations.md`: run
`azure:migrations:status`, review/apply pending migrations, then
`azure:schema:check` must report a clean match (exit `0`) before approving a
release. The `scripts/post-merge.sh` step that runs
`setup-price-history.ts` (creates the share-price-history immutability
trigger) must also have been run at least once against the target database —
I had to run it manually in my own local validation because it isn't part of
`pnpm push`/`drizzle-kit`, same as any trigger/function (Drizzle doesn't
manage those; see `docs/azure-schema-migrations.md`'s note on what the drift
checker does and doesn't inventory).

### File storage

| Variable | Notes |
|---|---|
| `OBJECT_STORAGE_PROVIDER` | **Confirmed `sharepoint`** in `.replit`'s `[userenv.production]` and cross-checked against `docs/azure-data-cutover.md` / `docs/migrated-file-access-verification.md`, which record the SharePoint cutover as the current, verified, published configuration. The Azure Blob (`azure`) and Replit-sidecar (`replit`) code paths are still present and both fully implemented, but are legacy/rollback-only per `docs/sharepoint-file-storage.md` — don't reintroduce them as the active provider without redoing that migration. |
| `SHAREPOINT_HOSTNAME` / `SHAREPOINT_SITE_PATH` / `SHAREPOINT_LIBRARY` / `SHAREPOINT_ROOT_FOLDER` | See `docs/sharepoint-file-storage.md`. Reuses the same `CLIENT_ID`/`CLIENT_SECRET`/`TENANT_ID` as sign-in, via an app-only Graph `client_credentials` grant — no separate App Registration needed, just the Graph permission (prefer `Sites.Selected`) added to the existing one. |
| `AZURE_STORAGE_CONNECTION_STRING` / `AZURE_STORAGE_CONTAINER` | Only needed if you ever deliberately switch back to `OBJECT_STORAGE_PROVIDER=azure` (migration/rollback scenario per the docs above) — not needed for the current SharePoint-backed deployment. |

### Session / encryption

| Variable | Notes |
|---|---|
| `SESSION_SECRET` | **Required.** Used both to key the session store (Drizzle-backed, not `connect-pg-simple`) and, separately (via HKDF with a different domain-separation label), to encrypt SSNs at rest in `lib/ssn.ts`. The app already throws `"SSN encryption is not configured"` if this is unset, so it's not something I needed to add — just flagging that it's doing double duty, so don't rotate it casually without a plan for re-encrypting existing SSN data. |

### Optional

| Variable | Notes |
|---|---|
| `CLERK_SECRET_KEY` | **Optional.** The app migrated from Clerk to Entra for sign-in, but `routes/history.ts` still calls Clerk's API as a best-effort lookup to resolve old pre-Entra history entries' actor IDs (`user_...`) to display names; it already catches failures and falls back to `"Former or unavailable employee (<id>)"`. Set this only if you still have the old Clerk account and want those old names to resolve; otherwise it's safe to leave unset. See "Suggestions" below — related dead code exists too. |
| `MAINTENANCE_READ_ONLY` | `.replit` has this as `"false"` in production. Set to `"true"` to put the app into read-only mode (GET/HEAD/OPTIONS only) during a data migration window. |

### Platform

| Variable | Notes |
|---|---|
| `PORT` | App Service/Container Apps typically injects this. |
| `NODE_ENV` | Set to `production`. |
| `STATIC_DIR` | Set by the Dockerfile to the built frontend's path. |

No `CORS_ORIGIN` setting is needed — `app.use(cors({ origin: false }))` fully
disables cross-origin requests, which is correct and unchanged for this
app's same-origin single-container deployment.

---

## Suggestions (non-blocking)

- **Dead Clerk-era code**: `artifacts/api-server/src/routes/settings-users.ts`
  and `artifacts/api-server/src/lib/access-users.ts` implement a full
  Clerk-based user/role management UI, but `settings-users.ts` is never
  mounted in `routes/index.ts` — it's unreachable. Likewise
  `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts` is never
  imported into `app.ts`. All three look like leftovers from before the
  Entra migration (consistent with `docs/azure-entra-readiness.md`'s note
  that the app now grants blanket tenant access with no per-user role
  mapping). Safe to delete if you don't plan to resurrect per-user roles;
  harmless to leave as-is either way since none of it runs.
- **Stale/orphaned test file**: `artifacts/api-server/src/lib/pilot-auth.test.ts`
  fails (`"A valid Microsoft Entra object ID is required."`) because it
  still exercises the pre-Entra `sub`-based "pilot" identity model that
  `identityFromClaims` in `lib/auth.ts` no longer supports. It isn't wired
  to any `package.json` `test:*` script and isn't referenced by the one
  GitHub Actions workflow (`azure-schema-approval.yml`), so it doesn't block
  anything today — but it will fail loudly if anyone runs
  `tsx --test src/lib/*.test.ts` directly, as I did for full validation.
  Recommend deleting it (its sibling `pilot-auth-flow.test.ts` already tests
  the current Entra flow and passes).
- The unused root-level `src/repl_nix_workspace` Python package
  (`pyproject.toml`) is Replit-template scaffolding — nothing in the Node
  app imports or runs it. Not installed or copied into the Docker image;
  safe to delete from the repo if you want to tidy up.
- `dist/index.mjs` is ~5.7 MB and the frontend's main JS chunk is ~620 KB —
  Vite's build warning suggests code-splitting if load time on slow
  connections matters; not addressed here since it's not Azure-specific.

---

## Files that need renaming

None.

---

## Validation performed this round

- `pnpm install --frozen-lockfile` (+ `pnpm approve-builds --all`, then
  reverted `pnpm-workspace.yaml` before committing, as always).
- `pnpm run typecheck` — clean across `api-server`, `shareholder-management`,
  `mockup-sandbox`, and `scripts`, including both edited files.
- Local Postgres standing in for Azure Postgres: pushed the Drizzle schema,
  then ran `artifacts/api-server/src/lib/setup-price-history.ts` (the
  trigger/function `post-merge.sh` installs) against it.
- `tsx --test` across every `*.test.ts` file in `artifacts/api-server/src`
  (112 tests): **109 passed**. The 2 failures in the already-orphaned
  `pilot-auth.test.ts` are pre-existing and unrelated to this round's
  changes (see "Suggestions" above). One failure in `share-prices.test.ts`
  was my own test-environment gap (hadn't run `setup-price-history.ts` yet)
  — it passes once that one-time setup step runs, same as it would need to
  in any fresh Azure database.
- Built the frontend (`PORT=24972 BASE_PATH=/`) and the API server — both
  clean.
- Verified the `AUTH_ALLOWED_HOSTS` matching logic directly (see the
  "Most important change" section above for why the live Microsoft redirect
  itself couldn't be exercised in this sandbox).
- Booted the compiled server with `DATABASE_PROVIDER=azure`,
  `OBJECT_STORAGE_PROVIDER=sharepoint`, and `STATIC_DIR` set, and confirmed:
  - `GET /` → 200, a deep client-side route → 200 (SPA fallback)
  - `GET /api/healthz` → 200 `{"status":"ok"}`
  - `GET /api/auth/user` (unauthenticated) → 200 `{"user":null}` (this
    route's contract, by design — the app doesn't treat an anonymous session
    check as an error)
  - `GET /api/shareholders` (unauthenticated, actually protected) → 401
  - an unknown `/api/*` route → 404 (confirmed this only after adding the
    `/api` catch-all described above — before that fix it wrongly returned
    200 with the SPA's `index.html`)

---

## Deploy steps summary

1. Follow `docs/azure-schema-migrations.md` to confirm the target Azure
   Postgres schema is current (`azure:schema:check` exit `0`) before
   release.
2. Confirm `OBJECT_STORAGE_PROVIDER=sharepoint` and the `SHAREPOINT_*` values
   per `docs/sharepoint-file-storage.md` — this is already the verified
   published configuration, not a new decision.
3. Register (or reuse) the Entra App Registration; add
   `https://<your-azure-host>/api/auth/callback` as a redirect URI, and set
   `AUTH_ALLOWED_HOSTS` to that same hostname.
4. Set `SESSION_SECRET` and all required env vars above.
5. Build and push the image:
   `docker build -t <registry>/shareholder-management:latest .`
6. Deploy to Azure App Service (Web App for Containers) or Container Apps,
   setting all environment variables above as App Settings/secrets.
7. After deploying, actually exercise `/api/login` end-to-end against your
   real Entra tenant — this sandbox couldn't reach `login.microsoftonline.com`
   to verify that leg itself.
