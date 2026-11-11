# Azure PostgreSQL schema migrations

Preview uses Replit PostgreSQL. Published Shareholder Management uses the
`AZURE_PG_*` settings and the schema named by `AZURE_PG_SCHEMA`. The regular
`@workspace/db` `push` command is for Preview only; it is not a production
migration workflow.

## Review and author a migration

1. Update and review the Drizzle definitions in `lib/db/src/schema/`.
2. Add a SQL file to `lib/db/migrations/` named
   `YYYYMMDDHHMMSS_lowercase_description.sql` using a UTC timestamp.
3. Include `-- Reviewed: <reviewer or change reference>` near the top.
   Migrations containing data changes or non-additive operations such as
   `DROP`, `DELETE`, `UPDATE`, `TRUNCATE`, rename, or column/type alteration
   must also include `-- Explicitly approved: <reason>`.
4. Keep each migration compatible with a transaction. Do not include your own
   `BEGIN`/`COMMIT`, and do not use operations that cannot run in a transaction.
5. Review the SQL against both the current schema definitions and Azure's
   existing schema. The runner is intentionally not a schema diff tool; it
   never infers or applies changes from Preview.

The safety check is a conservative tripwire, not a SQL parser. Reviewers must
inspect the full SQL and confirm that existing shareholder, certificate,
transfer, and audit records remain intact unless a specific data change has
been explicitly approved.

## Check and apply

With the Azure `AZURE_PG_*` environment variables configured in the authorized
environment, inspect the queue first:

```sh
pnpm --filter @workspace/db run azure:migrations:status
```

After reviewing the pending migration files and confirming the target schema,
apply them explicitly:

```sh
pnpm --filter @workspace/db run azure:migrations:apply
```

These commands require Azure-specific host, database, port, service-principal
user, password, schema, and TLS mode settings. The runner does not read or
fall back to `DATABASE_URL`; missing Azure settings stop the command before it
connects. `status` performs no schema writes. `apply` uses a session lock,
creates a small `__app_schema_migrations` ledger in the Azure schema, and
applies each migration in its own transaction. A failed migration is rolled
back; applied file contents are checksum-protected and must never be edited or
removed. Add a new migration to correct an applied change.

Do not run the Azure apply command from Preview or copy Preview data to
production. Use `pnpm --filter @workspace/db run push` only for Preview. Schema
changes are not run at app startup or automatically during publishing.

## Read-only Azure schema drift check

In an authorized environment with the Azure settings already configured, run:

```sh
pnpm --filter @workspace/db run azure:schema:check
```

This is separate from the migration ledger: it compares the **current Drizzle
exports** in `lib/db/src/schema/index.ts` against the configured Azure schema,
even if every migration is marked applied. Run it before approving a release.
If reviewed migrations are intentionally pending, missing objects are expected;
the comparison will report drift and is **not** release approval. Review the
pending SQL and migration status, apply only through the separate authorized
migration process, then run the comparison again. A clean post-migration
comparison is required before release approval; there is no waiver for expected
drift.

### Release approval gate

The `Azure schema release approval` GitHub Actions workflow runs only after a
push to `main`, not on pull requests. Configure the GitHub environment named
`azure-schema-approval` with required reviewer approval and these seven
environment secrets: `AZURE_PG_HOST`, `AZURE_PG_DATABASE`, `AZURE_PG_PORT`,
`AZURE_PG_SP_USER`, `AZURE_PG_PASSWORD`, `AZURE_PG_SCHEMA`, and
`AZURE_PG_SSLMODE`. Do not put these values in repository secrets or expose them
to pull-request workflows. The protected-environment reviewer authorizes the
read-only check; a successful workflow run is required before approving release
of that exact commit.

Any nonzero result blocks approval: exit **1** means drift, and exit **2** means
the schema could not be fully inspected. If a reviewed migration is intentionally
pending, keep the release blocked, apply it only through the separately
authorized process, and rerun the failed schema-check job. Approve only after
that same commit has a successful post-migration comparison. Do not rely on an
earlier successful run for a different commit.

This workflow does not apply migrations, run `push`, or publish the application.
It supplies no `DATABASE_URL`; the checker requires Azure settings and never
falls back to Preview. The workflow is not a replacement for configuring the
protected GitHub environment or following the same-commit release criterion.

The command requires all seven `AZURE_PG_*` settings listed above, including
the explicit schema and TLS mode. It does not read or accept Preview's
`DATABASE_URL`, and it never falls back to Preview when Azure configuration is
missing. Install the workspace's development tooling to run it (`tsx`,
`drizzle-kit`, and the SQL expression parser are development dependencies).
Do not run `push` against Azure to resolve its findings.

### Safety and output

- Only PostgreSQL catalogs are queried. No shareholder, certificate, transfer,
  audit, session, or migration-ledger rows are read; no defaults are executed.
- The connection starts with `default_transaction_read_only=on`. Inspection
  runs in a repeatable-read, read-only transaction, with a 15-second statement
  timeout and a 10-second connection timeout. No schema or data writes occur.
- The command produces JSON containing only the schema name, object names,
  object kinds, and changed property names. Column defaults, constraint
  expressions, connection details, credentials, and server error details are
  not printed.
- Exit **0** means match; **1** means drift (missing, unexpected, or changed
  objects); **2** means configuration, connection, permission, or unsupported
  metadata prevented a complete comparison. Never treat exit 2 as a match.
- The migration runner's `__app_schema_migrations` table is the only ignored
  table. Other unexpected tables are reported, not automatically removed.

The comparison covers ordinary/partitioned tables; column types, precision,
nullability, defaults, collation changes and serial-sequence ownership;
primary/unique keys; named CHECK expressions; foreign-key targets, column
order and update/delete actions; constraint validation/deferral; and explicit
indexes (uniqueness, method, ordered keys, null order, included columns,
predicates, validity, readiness, default opclasses/collations and storage
parameters). Table row-security flags are also compared.
Constraint-backed indexes are represented by their constraints, not duplicated
as explicit indexes. PostgreSQL's 63-byte identifier truncation is accounted
for, including existing long generated foreign-key names.

This is a structural tripwire, not a proof that arbitrary SQL expressions are
semantically equivalent. It recognizes PostgreSQL's common formatting changes,
literal casts, and `IN` → `ANY (ARRAY[...])` CHECK rewrites while preserving
grouping and string case. Other equivalent rewrites can require manual review.
Azure Database for PostgreSQL Flexible Server lists PostgreSQL 14–18 under
standard support and PostgreSQL 11–13 under Extended Support. This checker
requires PostgreSQL **15 or newer** because it reads catalog fields introduced
in PostgreSQL 15; servers older than 15 fail closed before catalog inspection.
The integration matrix covers the checker-supported Azure majors: PostgreSQL
15, 16, 17, and 18. See Microsoft's
[supported versions](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-supported-versions)
list for current service support. The current model does not inventory
views, functions, triggers, grants, standalone sequences, sequence counters,
partition bounds, policies, or constraint-backed index tuning. New Drizzle
identity/generated columns, policies, explicit index opclasses/storage
parameters, or cross-schema definitions require extending the checker first;
it refuses those expected definitions rather than claiming a match.
Unsupported live expressions fail the comparison safely.

Investigate each difference, then author and review a migration if a change is
needed. The checker never generates remediation SQL, applies changes, or
modifies the migration ledger.

## Tests

Run the migration workflow's isolated tests with:

```sh
pnpm --filter @workspace/db run test:azure-migrations
```

They verify Azure-only configuration, schema/TLS validation, review gates,
status being read-only, transactional application, rollback behavior, and
checksum protection. These tests use a fake PostgreSQL client and do not
connect to Azure or Preview.

Run the drift-check tests with:

```sh
pnpm --filter @workspace/db run test:azure-schema
```

The isolated fixtures cover matching/missing/changed/unexpected objects,
read-only catalog queries, rollback on inspection failure, PostgreSQL expression
normalization, and refusing missing Azure configuration even when
`DATABASE_URL` is set. When `initdb` and `pg_ctl` are installed, the same suite
also creates disposable local PostgreSQL instances (Unix sockets only), builds
the current Drizzle definitions, confirms a match as a role with **no
application-table SELECT privileges**, then checks deliberate CHECK, index,
and column-type drift. Each configured major gets a separate fresh cluster,
which is stopped and removed afterward. With no matrix configured, the suite
uses the PostgreSQL binaries on `PATH` for a local single-major run. To require
the full Azure-supported checker matrix, set
`SCHEMA_TEST_POSTGRES_BINARIES` to a JSON object mapping all four majors to
absolute directories containing that major's `initdb`, `pg_ctl`, and
`postgres`, then run the same command. For example:

```sh
SCHEMA_TEST_POSTGRES_BINARIES='{"15":"/opt/postgresql/15/bin","16":"/opt/postgresql/16/bin","17":"/opt/postgresql/17/bin","18":"/opt/postgresql/18/bin"}' \
  pnpm --filter @workspace/db run test:azure-schema
```

The matrix setting only selects local executable files. The harness initializes
each cluster in a private temporary directory, disables TCP listening, removes
`PG*`, `AZURE_PG_*`, and `DATABASE_URL` from PostgreSQL subprocesses, and never
accepts a database URL or connection override. Azure and Preview connections
are not used. When no matrix is configured, the real-PostgreSQL case is skipped
if PostgreSQL 15+ binaries are unavailable on `PATH`. When a matrix is
configured, missing or invalid binaries fail the suite instead of silently
skipping a major. Tests never use Azure or Preview connection settings.
### Real PostgreSQL integration tests

```sh
pnpm --filter @workspace/db run test:azure-migrations:postgres
```

Prerequisites: Node/pnpm dependencies installed and PostgreSQL 16's `initdb`
and `pg_ctl` on `PATH`, running as a non-root user. This Replit project already
includes the `postgresql-16` module. No database URL, credentials, existing
database, Docker, or application workflow is needed. Missing binaries or startup
failures fail the command; the suite never silently skips database tests.

The test harness initializes a fresh cluster in a randomly named, owner-only
temporary directory. TCP listening is disabled; clients use only its private
Unix socket. Each run creates its own `fictional_migration_test` database and
`migration_test_` schemas. There are no target connection arguments or
environment overrides: the harness does not use `DATABASE_URL`, `AZURE_PG_*`,
or `PG*` settings, and PostgreSQL subprocesses receive a minimal environment.
It cannot be pointed at Azure's schema or Preview's database.

Fixtures under `lib/db/scripts/fixtures/` contain only fictional records and
reviewed test SQL. They are deliberately **outside** `lib/db/migrations/`, so
the Azure release runner cannot discover or apply them. Do not move test SQL
into the release queue or seed tests from application data.

The suite exercises the same migration loader and apply/status functions as
the Azure CLI. It verifies additive DDL and an explicitly approved update/drop,
actual SHA-256 ledger values, unchanged repeat runs, missing/modified file
rejection, read-only status, and real CHECK-violation rollback of DDL and data.
It also forces a ledger insertion failure to prove the migration SQL and ledger
entry commit atomically. Earlier successful migrations remain committed, and a
failed unrecorded migration can be corrected and retried.

### Migration-runner permissions

The integration suite also creates fictional, non-login roles **only inside the
disposable cluster**. It uses `SET ROLE` on its private test connections and
checks that the effective role has no superuser, database/role creation,
inheritance, replication, or row-security bypass privileges. The cluster
administrator only arranges fixtures and checks results; migration calls run
under the restricted role. These tests never create, grant, revoke, or alter
roles in Azure or Preview, and do not test application audit permissions.

A successful restricted-role case demonstrates:

- `USAGE` and `CREATE` on the target schema are sufficient without schema
  ownership to create the ledger and new objects.
- The role owns the existing fictional table, allowing the reviewed
  `ALTER TABLE` and index creation as well as the explicitly approved data
  update and column removal. Table grants alone, even `ALL`, do not confer
  ownership required for these DDL operations.
- A ledger created by the role can be read and appended to over successive
  applies, with correct checksums, read-only status, and a no-op repeat apply.
  An existing ledger owned by another role needs `SELECT` for status/history
  validation and `INSERT` to record new versions. The runner appends rows; it
  does not require SQL `UPDATE` or `DELETE` on ledger history.

Negative cases independently withhold schema `USAGE`, schema `CREATE`, table
`UPDATE`, table ownership, ledger `SELECT`, or ledger `INSERT`. They assert
PostgreSQL permission errors and unchanged fictional data, pending DDL, and
prior ledger entries. The table failures execute a preceding `CREATE TABLE`;
the ownership failure also follows a successful data update. Missing ledger
`INSERT` fails after all pending SQL succeeds, proving DDL, data, and the ledger
entry remain atomic even when the final write is denied.

Ledger initialization is outside the per-migration transaction: a later table
permission failure may leave an **empty ledger**, but no partial migration.
Missing schema privileges in these fixtures leave no ledger at all. Earlier
successful migrations remain committed if a later migration fails.

For an authorized release, have the database owner review schema privileges,
ledger access, and ownership or required object privileges for **each reviewed
SQL file** before applying. These examples are a permission model, not blanket
grant instructions or proof that every future migration has sufficient rights:
other objects, sequences, or row-security policies can have additional
requirements. Do not grant superuser as a workaround, and do not run role
setup from this suite against Azure or Preview.

Cleanup closes clients, stops the cluster, and deletes its temporary directory
on success or test failure. A forcibly killed test process (for example SIGKILL)
cannot run cleanup: stop only the orphan test cluster with
`pg_ctl -D <temporary-directory>/data -m immediate -w stop` before removing
that directory. Never substitute an application database data directory.
