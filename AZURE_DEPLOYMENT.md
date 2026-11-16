# Deploying Shareholder-Management to Azure

This app ships on Replit as two separate services: `api-server` (the Express
API) and `shareholder-management` (the Vite/React frontend). Azure App
Service / Container Apps runs one container per app, so this repo now
packages both into a single image: the API server also serves the built
frontend as static files, with an SPA fallback for client-side routes.
`artifacts/mockup-sandbox` is a Replit-only dev/preview tool (no
`[services.production]` section in its `.replit-artifact/artifact.toml`) and
is intentionally excluded.

## New changes made this round

### 1. `/api` 404 catch-all (bug fix — `artifacts/api-server/src/app.ts`)

No router mounted under `/api` 404s an unmatched path itself. Once the
`STATIC_DIR` SPA-fallback block below is active, an unknown `/api/*` path
(a typo, a removed endpoint, a bot probe) fell through into that fallback
and wrongly returned `200` with `index.html` instead of `404`. Verified live:
`curl /api/does-not-exist` now correctly returns `404 {"error":"Not found"}`.
**HIGHLIGHTED NEW CHANGE** — added immediately after `app.use("/api", router)`
and before the existing error handler:

```ts
app.use("/api", router);
// AZURE: this app's own routers never 404 unmatched paths themselves (no
// catch-all inside routes/index.ts), so an unknown /api/* path would
// otherwise fall through to the SPA static fallback below and wrongly
// return 200 with index.html once STATIC_DIR serving is added for Azure.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});
```

### 2. `trust proxy` (bug fix — `artifacts/api-server/src/app.ts`)

Azure terminates TLS at the platform load balancer and forwards plain HTTP
to the container with `X-Forwarded-*` headers. Without `trust proxy`,
Express doesn't see the request as secure, which breaks secure cookies and
the `APP_PUBLIC_ORIGIN`/host-validation logic described below. **HIGHLIGHTED
NEW CHANGE** — added right after the app is created:

```ts
const app: Express = express();
app.set("trust proxy", 1);
```

### 3. `STATIC_DIR` static + SPA fallback (new capability — `app.ts`)

On Replit, the frontend and this API are two separately-deployed services.
On Azure they ship as one container. **HIGHLIGHTED NEW CHANGE** — added
after the error handler, gated on an env var so local dev (where `STATIC_DIR`
is unset) is unaffected:

```ts
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  const indexHtml = path.join(staticDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    throw new Error(`STATIC_DIR is set to "${staticDir}" but "${indexHtml}" does not exist. Did the frontend build run?`);
  }
  app.use(express.static(staticDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(indexHtml);
  });
}
```

### 4. `Dockerfile` / `.dockerignore` (new files)

Single-stage build (pnpm's symlinked store doesn't survive a plain `COPY`
across multi-stage layers cleanly), builds the frontend then the API,
excludes `mockup-sandbox`. Already includes `lib/share-quantities`'s
`package.json` (see "New workspace package" below).

### 5. `APP_PUBLIC_ORIGIN` replaces the old `AUTH_ALLOWED_HOSTS` approach

**No code change needed this round** — the project's own team has already
replaced my prior round's `AUTH_ALLOWED_HOSTS` fix with a cleaner mechanism:
a new module, `artifacts/api-server/src/lib/application-origin.ts`, exposes
`configuredApplicationOrigin()`, and `routes/auth.ts`'s `origin()` now uses
it to validate the request's `Host`/`X-Forwarded-Host` against a single,
server-configured HTTPS origin instead of trusting the incoming request host
directly. This is a better design than my earlier allow-list fix (exact
origin match, not just a hostname-suffix check), so there's nothing to fix —
just a required env var to set on Azure (see below). This also means
sign-in no longer silently works only on `*.replit.dev`/`*.replit.app`
domains; without `APP_PUBLIC_ORIGIN` set, production sign-in is refused
outright rather than guessing.

### 6. New feature: legacy data import (`lib/legacy-import/*`, `routes/legacy-import.ts`)

A new, one-time XLSX-based utility for migrating legacy shareholder records.
It is deliberately conservative about where it will run:

- In Replit development (`NODE_ENV=development`, default `DATABASE_PROVIDER`),
  it runs in **preview** mode against anonymized sample data only.
- On Azure, it only switches into **azure** (live, add-only) mode when ALL
  of the following are true: `NODE_ENV=production`, `DATABASE_PROVIDER=azure`,
  the app detects it is actually running on Azure App Service or Container
  Apps (via `WEBSITE_INSTANCE_ID`/`WEBSITE_SITE_NAME`/`WEBSITE_HOSTNAME`
  ending in `.azurewebsites.net`, or the Container Apps equivalents), it is
  **not** also running on Replit, `APP_PUBLIC_ORIGIN` is a valid non-Replit
  HTTPS origin, `OBJECT_STORAGE_PROVIDER=sharepoint` with full SharePoint +
  Entra config present, and `TENANT_ID` is a well-formed GUID.
- Optional overrides: `LEGACY_IMPORT_MODE` (`off`/`preview`/`azure`) and
  `LEGACY_IMPORT_ENABLED` (`true`/`false`) can force the mode or disable it
  entirely regardless of the auto-detection above.

No code change needed for Azure deployment — this feature self-gates
correctly as long as the env vars below are set. It's backed by a new,
Drizzle-managed table (`legacy_imports`), so `pnpm run push` creates it
automatically; no manual SQL step is required.

### 7. New workspace package: `lib/share-quantities`

A new shared package used by `lib/certificates.ts`, `lib/report-data.ts`,
`lib/certificate-pdf.ts`, and `lib/legacy-import/convert.ts`. Already added
to the Dockerfile's `COPY` list (`lib/share-quantities/package.json`).

## Suggestions (not blocking)

- **Dead Clerk-era files are still present and unused**: `src/routes/settings-users.ts`,
  `src/lib/access-users.ts`, `src/middlewares/clerkProxyMiddleware.ts`. None
  are imported or mounted anywhere (confirmed via grep again this round).
  Safe to delete whenever convenient; not required for Azure.
- `dist/index.mjs` is ~5.8 MB after bundling (plus a 10 MB sourcemap) — fine
  to ship, just note cold-start size if using Consumption-plan Container Apps.
- The built frontend bundle is ~637 KB (188 KB gzipped) in a single chunk;
  Vite suggests code-splitting via dynamic `import()` if load time matters.

## Files that need renaming

None. All filenames stay the same; only `app.ts` changed, plus new
`Dockerfile`/`.dockerignore`/`AZURE_DEPLOYMENT.md`.

## Required environment variables on Azure

### Microsoft Entra ID (sign-in)
| Variable | Notes |
|---|---|
| `CLIENT_ID` | Entra app registration client ID |
| `CLIENT_SECRET` | Entra app registration client secret |
| `TENANT_ID` | Entra tenant ID (GUID) |
| `APP_PUBLIC_ORIGIN` | **Required on Azure.** Single HTTPS origin, no path/credentials/query/port, e.g. `https://shareholder-management.azurewebsites.net`. Without this, sign-in is refused outside `*.replit.dev`/`*.replit.app`. |

### Database
| Variable | Notes |
|---|---|
| `DATABASE_PROVIDER` | Set to `azure` |
| `AZURE_PG_HOST` | Azure PostgreSQL server hostname |
| `AZURE_PG_PORT` | TCP port (typically `5432`) |
| `AZURE_PG_DATABASE` | Database name |
| `AZURE_PG_SP_USER` | Service principal / login user |
| `AZURE_PG_PASSWORD` | Password |
| `AZURE_PG_SCHEMA` | Postgres schema (search path) |
| `AZURE_PG_SSLMODE` | e.g. `require` |

### File storage (SharePoint)
| Variable | Notes |
|---|---|
| `OBJECT_STORAGE_PROVIDER` | Set to `sharepoint` |
| `SHAREPOINT_HOSTNAME` | SharePoint tenant hostname |
| `SHAREPOINT_SITE_PATH` | Site path |
| `SHAREPOINT_LIBRARY` | Document library name |
| `SHAREPOINT_ROOT_FOLDER` | Root folder within the library |

Uses the same `CLIENT_ID`/`CLIENT_SECRET`/`TENANT_ID` as sign-in via
app-only `client_credentials` Graph access.

### Session / security
| Variable | Notes |
|---|---|
| `SESSION_SECRET` | At least 32 characters. Dual purpose: session signing AND (via HKDF) the SSN-field encryption key — do not rotate casually, as rotating it without a migration plan makes previously-encrypted SSNs unreadable. |

### Legacy import (optional overrides)
| Variable | Notes |
|---|---|
| `LEGACY_IMPORT_MODE` | Optional override: `off` / `preview` / `azure`. Leave unset to let auto-detection decide. |
| `LEGACY_IMPORT_ENABLED` | Optional `true`/`false` kill switch. |

### Optional
| Variable | Notes |
|---|---|
| `CLERK_SECRET_KEY` | Optional — only used to resolve historical actor display names from the app's pre-Entra Clerk era. Safe to omit. |
| `MAINTENANCE_READ_ONLY` | Set `true` to put the app into read-only mode (503 on all non-GET requests) during a data migration window. |

### Platform (set by the Dockerfile; override only if needed)
| Variable | Notes |
|---|---|
| `PORT` | `8080` at runtime (frontend build uses `24972` internally, not exposed) |
| `STATIC_DIR` | `/repo/artifacts/shareholder-management/dist/public` — baked into the image |
| `NODE_ENV` | `production` |

## Validation performed this round

- `pnpm install --frozen-lockfile` — clean (one `ERR_PNPM_IGNORED_BUILDS`
  prompt resolved via `pnpm approve-builds --all`, then reverted the
  resulting `pnpm-workspace.yaml` mutation before committing).
- `pnpm run typecheck` — clean across all 4 workspace projects with a
  typecheck script (api-server, mockup-sandbox, shareholder-management,
  scripts).
- Full test suite — **163/163 passing**, run in two passes against a freshly
  created local Postgres database each time (this split is a test-environment
  requirement, not an app bug — see note below):
  - 125/125 passing with `NODE_ENV=test` (everything except
    `lib/legacy-import/*.test.ts`).
  - 38/38 passing with `NODE_ENV=development` for
    `lib/legacy-import/import.test.ts` and `access.test.ts` (these
    specifically exercise "preview mode," which the app only enables when
    `NODE_ENV==="development"`; they also require
    `LEGACY_IMPORT_TEST_CLUSTER=owned-disposable` to be set, a deliberate
    safety rail in the test files themselves against accidentally running
    against a shared database).
  - Note: running either group twice in a row against the same database
    without recreating it causes a real foreign-key violation (leftover
    `transfer_requests` rows referencing deleted `share_transfers` rows) —
    this is a test-fixture gap in `import.test.ts`'s `beforeEach` cleanup,
    not a production bug, and doesn't affect a normal CI run (each run
    against a fresh database, once).
- Frontend build (`pnpm --filter @workspace/shareholder-management run build`)
  — clean (only cosmetic sourcemap warnings for `tooltip.tsx`/`select.tsx`/
  `label.tsx`).
- API build (`pnpm --filter @workspace/api-server run build`) — clean.
- Live boot test with `STATIC_DIR` and `APP_PUBLIC_ORIGIN` set:
  - `GET /` → `200`
  - `GET /some/deep/client/route` → `200` (SPA fallback)
  - `GET /api/healthz` → `200`
  - `GET /api/shareholders` (unauthenticated) → `401`
  - `GET /api/does-not-exist` → `404 {"error":"Not found"}` (confirms the
    new catch-all fix)
  - `GET /api/login` → `500` in this sandbox only because `openid-client`'s
    discovery call to `login.microsoftonline.com` has no network access
    here; this is a sandbox limitation, not an app or deployment bug (same
    limitation noted in the prior round for this app).

GitHub push access remains structurally blocked for this session, so changes
are committed locally only — pull the commit from the delivered zip.
