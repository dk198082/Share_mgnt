# Microsoft Entra sign-in

## Approved behavior

The application uses direct, tenant-specific Microsoft Entra OpenID Connect for
employee sign-in. It reads only `CLIENT_ID`, `CLIENT_SECRET`, and `TENANT_ID`
from Replit Secrets for Entra authentication. The app does not call an Admin
Console, Microsoft Graph, or a separate authorization service, and it does not
map Entra roles.

Any successfully authenticated account in the configured tenant receives the
same application access. Pending share issuance and transfer approvals remain
restricted to the Settings signers whose configured email matches the
authenticated tenant sign-in address. Replit private publishing can still
require a publishing invitation before a user reaches the application.

Shareholder self-service remains out of scope until the user explicitly starts
phase 2.

## Entra app registration

The backend uses tenant-specific OIDC discovery at:

```text
https://login.microsoftonline.com/{TENANT_ID}/v2.0
```

Register the exact HTTPS callback URL for each environment:

```text
https://<published-app-host>/api/auth/callback
https://<development-app-host>/api/auth/callback
```

The development host may change; each active host must match an exact redirect
URI in the Entra app registration. The application derives the callback host
from its HTTPS Replit app request and accepts `.replit.app` and `.replit.dev`
hosts. Local test authentication uses an isolated synthetic OIDC issuer only
when running under `NODE_ENV=test`.

The app requests `openid profile email offline_access`. It does not request
Microsoft Graph access. Replit's existing `SESSION_SECRET` remains untouched;
it is not an Entra credential and also protects encrypted SSN data.

## Authentication and identity handling

- Use authorization code flow with S256 PKCE, state, nonce, ID-token signature,
  issuer, audience, expiry, and configured tenant validation.
- Require the Entra tenant ID (`tid`) and object ID (`oid`). Use `oid` as the
  current employee actor ID; never use email or display name as the actor key.
- Keep current Entra profiles in the server-side session instead of writing them
  into the legacy `users` table, whose unique email constraint belongs to older
  provider identities. This prevents an email match from merging account IDs.
- Use the signed `preferred_username`/UPN as the employee sign-in address when
  an email claim is unavailable. Signer matching remains an exact normalized
  address comparison; a transfer link alone never grants approval.
- Preserve existing historical Replit and Clerk actor IDs, event-time names,
  approvals, and certificate history. Do not auto-merge old identities based
  on matching email or name.
- Store opaque server-side sessions only. Do not expose access, refresh, or ID
  tokens to browser JavaScript, URLs, audit logs, or error responses. Invalidate
  legacy pilot sessions and require users to sign in again.
- Preserve safe same-origin return paths, logout behavior, and sign-off deep
  links. Microsoft login opens outside the embedded Replit preview.

## Scope and access implications

In addition to Microsoft Entra authentication, the Admin Console must grant
the employee Read Only or Read / Write access to Shareholder Management.
Replit's private-publishing gate remains separate.

The API checks Admin Console access at sign-in, at token refresh, and on the
first authenticated request at least 60 seconds after the previous check. A
downgrade takes effect before that request is handled. If access was removed
or cannot be verified (including during an outage), the session is invalidated
and the user must sign in again. All checks run server-side; the API key is
never sent to the browser.

The tenant sign-in address is used for signer matching; it is not a separate
mailbox ownership verification process. Configure each Settings signer's email
to match the address Entra returns for that person.

## Verification

`artifacts/api-server/src/lib/pilot-auth-flow.test.ts` exercises signed OIDC
callbacks, PKCE, session cookies, deep links, signer identity, logout,
cross-tenant rejection, and mid-session access changes and outages. Run it
against isolated PostgreSQL with `pnpm --filter @workspace/db run test:legacy-import`.
Production and Preview must both have Entra and Admin Console credentials
configured. No secret values belong in source, logs, or documentation.
