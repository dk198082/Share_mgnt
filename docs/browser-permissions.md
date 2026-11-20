# Browser permission regression checks

The **Browser permission regression** GitHub check runs against pull requests and pushes to `main`. It does not connect to the running app or any deployed service. To run locally with Node 24, pnpm, PostgreSQL's `initdb` and `pg_ctl`, and `openssl` on `PATH` (as a non-root user):

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts exec playwright install chromium
pnpm --filter @workspace/db test:browser-permissions
```

For an environment with an existing compatible Chromium executable, set `BROWSER_EXECUTABLE` to its path instead of installing Playwright's Chromium. Chromium may also require platform runtime libraries.

The launcher creates a fresh PostgreSQL cluster on a private Unix socket, builds the real web app, and starts the real API and a local HTTPS fixture. The browser signs in twice through the app's OIDC login and callback using a local issuer with signed ID tokens, single-use codes and PKCE, and a mocked Admin Console that returns each role. The two Chromium contexts do not share cookies. The suite does not use existing sessions, inject user headers or replace permission middleware. After both logins, the isolated API process selects its development runtime so the real synthetic Preview import policy is active. No app, storage, Entra or database credentials are inherited, and database and build files are discarded after the run.

Assertions cover Shareholder records, certificate and transfer controls, sign-off decisions (including a viewer who is a named signer), uploads, Settings, and staging and committing an import. Viewer sessions can browse and download all three report workbooks, but receive the read/write entitlement error on direct write requests; the suite compares database contents before and after those requests. The editor gets the matching controls and creates one fictional Shareholder. Editor approvals, uploads, and import commits are not submitted to external services.
