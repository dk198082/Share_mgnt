# Using the import utility in Azure

## Who can use it?

**Anyone signed into the Azure application can use Settings → Data import.**
There is no separate import role, Entra group, permission assignment, approval
workflow or additional sign-in. Existing Microsoft sign-in remains unchanged.

The small employee team shares import access, just as it shares other app
functions. The application still records who staged and committed each import.
Certificate and transfer sign-offs continue to use the people configured in
Settings; importing does not change those rules.

## How to run an import

1. Sign into the Azure application as usual.
2. Open **Settings → Data import** and select the Excel files together.
3. Confirm that the files are intended for this Azure import, then select
   **Stage and validate**.
4. Review errors, warnings, counts and ownership balances. Nothing has been
   added to the shareholder ledger at this stage.
5. Resolve blocking errors, acknowledge warnings and confirm **Commit import**.
6. Check the resulting balances and retain the run report.

The import is add-only. It does not delete, reset or overwrite existing records.
A duplicate or conflicting record is reported rather than replaced. Retrying a
completed package returns the existing result, without adding duplicate records.

Use the complete source package for Azure imports. Unresolved certificate owners,
unsupported movements and mismatched balances block the load. Historical dates,
original certificate numbers and two-decimal share quantities are preserved.

Original Excel files are retained privately in SharePoint and checked for
integrity at staging and before commit. PostgreSQL stores normalized staging,
provenance, hashes and file references, not workbook bytes. Historical certificate
PDF ZIP/folder importing is separate functionality and is not included here.

## One-time Azure deployment checks for IT

No import-specific activation is required in a correctly configured Azure
production deployment. The utility recognizes Azure App Service or Container
Apps and uses the application's existing settings:

| Existing app setting | Expected value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_PROVIDER` | `azure` |
| `OBJECT_STORAGE_PROVIDER` | `sharepoint` |
| `APP_PUBLIC_ORIGIN` | The Azure application's exact public HTTPS origin |

Preserve the existing database, Microsoft sign-in, session, SSN encryption and
SharePoint configuration/secrets. Register the application's normal sign-in
callback at `<APP_PUBLIC_ORIGIN>/api/auth/callback`. Do not add import-specific
Entra roles or Graph permissions.

Use the normal reviewed database release process to ensure `legacy_import_runs`
exists in the app schema, including its unique fingerprint constraint. The
migration is `lib/db/migrations/20261113200000_legacy_import_runs.sql`.

Verify with synthetic files in a separate Azure test schema that ordinary
signed-in employees can stage, view runs and commit; signed-out callers cannot;
SharePoint evidence verifies; and ledger balances and audit attribution match.
Local automated tests do not replace live Azure deployment verification.

IT can optionally pause all imports with `LEGACY_IMPORT_ENABLED=false` and
restart/recycle the application. Removing that setting restores normal automatic
availability. An existing `LEGACY_IMPORT_MODE=off` setting also pauses imports;
remove obsolete overrides when deploying this simplified version. There is no
Settings permission screen to maintain. The old import-role setting is unused.

## Boundaries that remain

- Real-data importing stays blocked on Replit, even with an Azure database.
- Preview accepts anonymized/synthetic samples only.
- Existing application sign-in is required; anonymous access is not introduced.
- No reset, production load, deployment change or source cleanup was performed
  by this code change. Actual production execution remains separately approved.
- Retained files from an interrupted stage are not automatically deleted or
  overwritten; cleanup follows the agreed retention policy.
