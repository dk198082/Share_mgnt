# Azure data cutover

## Current file-storage requirement

The user clarified that application files must use **SharePoint**, not an Azure
Blob Storage account. The Azure Blob sections below describe earlier work,
not the current target or instructions to activate Blob Storage.
Azure PostgreSQL database hosting is a separate concern and is unchanged.
See `migrated-file-access-verification.md` for the corrected verification scope.

## Verified copy — 2026-11-10

- Destination database: `d365crm`.
- Active application schema: `Shareholdermanagement`.
- Production is the authoritative active ledger: 243 rows across 17 application
  tables were copied, including 18 Shareholders, 43 certificates, 12 transfers,
  settings, signers, histories, and document references.
- Preview was not merged into the active ledger. Its 250 application rows are
  retained as JSONB records with a manifest in the separate
  `Shareholdermanagement_preview_archive` schema.
- Both Replit source databases were left unchanged.
- Authentication sessions were deliberately excluded from both copies. Users
  must establish fresh Microsoft Entra sessions; historical user and actor
  records were preserved.

The copy committed as one Azure transaction only after both the active data and
the Preview archive passed full-row, bidirectional multiset comparisons.
Source counts and checksums were checked again immediately before the copy.
The Azure application schema matched the current Drizzle definitions.

Files themselves remain in Replit App Storage. Their database references were
copied unchanged, including certificate PDFs, templates, signatures, and
attachments. This operation did not migrate file bytes to Azure Blob Storage.

## Azure Blob Storage migration

The API supports a private Azure Blob container while keeping database object
paths such as `/objects/uploads/<id>` unchanged. The same paths continue to be
used for certificate templates and immutable completed certificate PDFs.

Configure these values only in the approved environments:

- `AZURE_STORAGE_CONNECTION_STRING` — Replit Secret; never put it in a file,
  command argument, log, or migration manifest.
- `AZURE_STORAGE_CONTAINER` — name of a pre-created private container.
- `OBJECT_STORAGE_PROVIDER=azure` — enable Azure only after the migration has
  been copied and verified in the database environment serving the application.

The Azure container must remain private; do not enable anonymous container
access. Browser uploads pass through the employee-authenticated API and the
server writes them to Azure, so Azure CORS does not need to allow the browser
directly. Application downloads also continue through authenticated API routes.
The connection string must permit the server to read, create, and write blobs
and inspect the container access setting.

Run the object migration from an environment that can read the source
Replit/App Storage objects and the database containing the active references:

```sh
pnpm --filter @workspace/api-server run migrate:azure-objects
```

The migration script gathers upload, shareholder photo/document, sign-off,
approval-signature, transfer-attachment, certificate-template, and completed
certificate-PDF references. For each path it copies bytes to the same blob name,
compares SHA-256 and content type after reading the destination back, and writes
a JSON manifest under `generated-artifacts/`. It refuses to overwrite a
destination with different bytes. It does not modify database paths or delete
source objects. A failed copy stops the run and leaves source files intact.

The published download verification attempt is recorded in
[`migrated-file-access-verification.md`](migrated-file-access-verification.md).
The operator-run check passed authenticated downloads and anonymous denial for
all 10 API-listed files. A subsequent read-only SharePoint check verified all 12
production registered/referenced objects, including hashes and metadata, without
contacting Blob Storage. The latest successful published build matches the
SharePoint implementation/configuration. Photos/documents had no references to
test. This is not cleanup approval.

Before switching the serving API to Azure, confirm the manifest covers every
reference. After the Azure-backed API is running, test authenticated downloads
for a certificate PDF, a template, a signature image, a shareholder
photo/document, and a transfer attachment using the intended employee/admin
roles. Verify the app's normal authenticated API routes return the files. Keep
the Replit source objects until these checks pass; source cleanup is a separate,
explicit operation and is intentionally not part of the migration command.

## Published configuration after the SharePoint file cutover

The verified main-project SharePoint release records:

```text
DATABASE_PROVIDER=azure
MAINTENANCE_READ_ONLY=false
OBJECT_STORAGE_PROVIDER=sharepoint
```

The latest successful deployment build matches that SharePoint release, as
recorded in `migrated-file-access-verification.md`. The older verification-task
checkout retained `OBJECT_STORAGE_PROVIDER=azure`; that snapshot must not be
mistaken for the newer published configuration or reapplied over it.

The Azure PostgreSQL ledger is separate from SharePoint file storage. The
verification made no deployment/configuration changes and did not contact
Azure Blob Storage. Keep source originals pending separately authorized cleanup.

Preview remains on its separate Replit database; it is not connected to the
active Azure production ledger.
