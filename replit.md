# Shareholder Management

Internal shareholder registry for company HR and Finance employees.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run azure:migrations:status` — inspect pending Azure schema migrations
- `pnpm --filter @workspace/db run azure:migrations:apply` — explicitly apply reviewed migrations to Azure
- `pnpm --filter @workspace/db run azure:schema:check` — compare Azure schema catalogs with Drizzle, read-only (never Preview)
- `pnpm --filter @workspace/db run test:azure-schema` — test the schema drift check without using Azure or Preview
- `pnpm --filter @workspace/db run test:azure-migrations` — test the Azure migration workflow without connecting to a database
- `pnpm --filter @workspace/db run test:azure-migrations:postgres` — verify migrations on a private disposable PostgreSQL cluster, never Azure or Preview
- Preview uses Replit PostgreSQL via `DATABASE_URL`. Production is configured with `DATABASE_PROVIDER=azure` for the next publish; the API reads `AZURE_PG_HOST`, `AZURE_PG_DATABASE`, `AZURE_PG_PORT`, `AZURE_PG_SP_USER`, `AZURE_PG_PASSWORD`, `AZURE_PG_SCHEMA`, and `AZURE_PG_SSLMODE`. See `docs/azure-data-cutover.md` for copy verification and activation status.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- Employee sign-in uses tenant-specific Microsoft Entra OIDC with server-side sessions and the `CLIENT_ID`, `CLIENT_SECRET`, and `TENANT_ID` Replit secrets. Do not call an Admin Console, Microsoft Graph, or another authorization service. Every authenticated user in the configured tenant has equal app access; named sign-off rights still require a matching Settings signer. Replit private publishing can remain an additional entry gate. Preserve individual Entra object IDs and historical actor records.
- Clerk is no longer an active sign-in dependency. The legacy history directory lookup is retained only to resolve older Clerk actor IDs; historical actor snapshots must not be rewritten. New actions use the tenant's Entra object ID, and old Replit/Clerk actors are not automatically merged by email.
- Entra sign-in behavior and its tenant-wide access implications are documented in `docs/azure-entra-readiness.md`. The app does not use a separate Admin Console or role mapping. A Replit private-publishing invitation, if required by the deployment, remains separate from Entra authentication.
- SSN encryption uses AES-256-GCM with a domain-separated key derived from `SESSION_SECRET`. Preserve that secret; rotation requires migrating encrypted SSNs first. The API exposes only the last four digits, never plaintext.
- Financial details are notes until company-specific fields are confirmed. Certificate identity business rules are in `.agents/memory/certificate-rules.md`. Share totals come from outstanding certificate records, never arbitrary shareholder-form rows.
- Issuance and transfer execution are atomic; duplicate request keys replay the original result without allocating another number. Full/partial transfers preserve original issued quantities and move only available balances. All Settings-configured signers must approve issuance and transfers; completed certificate PDFs are retained with transaction history.

## Product

Employee dashboard, filterable shareholder registry, create/view/edit records, private photos and documents, and certificate-backed Holdings - Shares. Fictional sample records exist in development; their original holdings were converted without inventing issue dates. Employees can issue certificates or request full/partial transfers to existing shareholders or atomically create a new recipient after approval. Both owners see linked transfer history and updated balances/statuses. Run `pnpm --filter @workspace/api-server run test:certificates` for isolated PostgreSQL issuance, approval, transfer, retry, concurrency and conservation checks.

### Transfer approvals

- Transfer History is `/transfers`; Pending Sign Off Requests is `/sign-off-requests`. Individual requests have authenticated, copyable deep links, including legacy `/transfer-requests/:id` links.
- A verified account email must match a captured Settings signer email to approve. No CEO/CFO or Administrator role grants approval rights. Submitters who are configured signers may approve their own requests. Never accept a signer identity supplied in the decision body.
- All captured signers are required, in any order. To change request details, reject and resubmit. Decisions retain individual actor IDs, configured signer snapshots, and timestamps.
- Pending requests neither reserve shares nor allocate certificate numbers or create new recipients. Final approval rechecks availability under lock and commits the final signature and ledger mutation together, or rolls everything back. Competing requests may require rejection/resubmission if shares are no longer available.
- Outlook approval emails honor each signer's captured notification preference. The requester's result notification is separate. A link alone grants no access. Signing in from an approval link returns to the request.
- Historic transfers remain completed history; they are not retroactively presented as approved.
- The post-merge script adds schema changes in development before workflow reconciliation; there is no startup-time DDL.
- Published production is the authoritative ledger for the requested Azure data move; Preview must be retained separately as an archive, not merged into live share ownership. Do not switch the production database provider until the production copy and isolated Preview archive are verified. Entra authentication is independent of that database cutover.
- Azure schema changes use reviewed, versioned SQL migrations in `lib/db/migrations/`; production migration commands use only `AZURE_PG_*` settings and never fall back to Preview's `DATABASE_URL`. See `docs/azure-schema-migrations.md`.

## User preferences

See `.agents/memory/phase-scope.md` for the user's standing phase boundaries.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
