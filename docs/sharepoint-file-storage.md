# SharePoint file storage

The application supports `OBJECT_STORAGE_PROVIDER=sharepoint`. This stores new
uploads, shareholder documents/photos, approval signatures, editable templates,
and completed certificate PDFs in the configured SharePoint document library.
The shareholder ledger and file references remain in PostgreSQL.

## Configuration

Use the existing server-side `CLIENT_ID`, `CLIENT_SECRET`, and `TENANT_ID`, plus:

- `SHAREPOINT_HOSTNAME`: SharePoint hostname, without a site URL.
- `SHAREPOINT_SITE_PATH`: site-relative path, such as `/sites/Example`.
- `SHAREPOINT_LIBRARY`: exact document-library name or drive ID.
- `SHAREPOINT_ROOT_FOLDER`: existing library-relative application folder.

The Microsoft application needs Graph application permissions sufficient to
resolve the site/library and read/write files. Prefer `Sites.Selected` with a
write grant to the intended site when feasible; tenant permission changes require
Microsoft administrator consent. App sign-in remains unchanged.

File bytes use the established subfolders and object identifiers. An application
`.shareholder-metadata` folder retains original MIME types, byte lengths,
SHA-256 hashes, and application ACL metadata. Keep it with the files: the API
rejects missing, mismatched, or corrupt metadata rather than serving unverifiable
content. No public sharing links are created. Restrict the SharePoint library's
own permissions appropriately; existing SharePoint users may have access outside
the application.

## Browser access and immutability

Upload registration still returns an authenticated API upload URL, never a
Microsoft token, SAS, or SharePoint upload-session URL. The API enforces employee
identity, upload ownership, registered MIME type, size limit, and request origin.
Downloads remain authenticated API responses and validate file hashes.

New payloads use Graph upload sessions with conflict behavior `fail`; existing
certificate bytes are not overwritten. MIME/ACL sidecars are stored in the same
SharePoint library. The SharePoint runtime does not require either Azure Blob
secret. Legacy Azure/Replit adapters are retained only for explicit migration or
rollback; there is no automatic read/write fallback when SharePoint is selected.

## Copy and verify existing files

From the workspace root, to migrate the active Azure PostgreSQL file references
from Azure Blob:

```sh
DATABASE_PROVIDER=azure OBJECT_STORAGE_PROVIDER=azure \
  pnpm --filter @workspace/api-server run migrate:sharepoint
```

The script collects file registrations and references from shareholder records,
templates, completed PDFs, signers, approval snapshots, and transfer histories.
It copies bytes and metadata, downloads and compares the destination, and writes
a report to the workspace's ignored `generated-artifacts` directory. It never
changes database rows or deletes/modifies source files. It refuses conflicting
destination bytes. An interrupted copy can be rerun: identical payloads are
reused and missing metadata is completed. A conflicting or zero-byte destination
is not overwritten automatically: inspect incomplete upload sessions before
attempting recovery.

For read-only source/destination verification:

```sh
DATABASE_PROVIDER=azure OBJECT_STORAGE_PROVIDER=azure \
  pnpm --filter @workspace/api-server run migrate:sharepoint -- --verify-only
```

The final reference set is checked again. New files or errors block a successful
report; investigate and rerun instead of switching with incomplete copies.
If Preview still uses its separate Replit database/storage, copy those references
as well before enabling SharePoint there:

```sh
DATABASE_PROVIDER=replit OBJECT_STORAGE_PROVIDER=replit \
  pnpm --filter @workspace/api-server run migrate:sharepoint
```

Shared destination paths must have identical bytes and metadata; the copy refuses
to choose one version over another. This does not merge or change either database.

During final cutover, stop new uploads/approvals until the final comparison and
publication are complete, so the old live deployment cannot create uncopied
Azure files between verification and publishing.

After a successful final verification, set `OBJECT_STORAGE_PROVIDER=sharepoint`
for the intended environments and publish to activate the production code and
configuration. Changing a production variable does not update an already
running deployment. Confirm signed-in uploads and existing downloads before
retiring Azure Blob resources. Original backups should remain untouched until
separately approved for cleanup.
