# Azure deployment support

The Preview boundary below remains in force. Azure now has a separate,
execution mode available to every signed-in application user. See
[Azure import authorization and configuration](azure-import-setup.md) for the
normal Azure deployment checks and the simplified import steps.
This does not authorize a production reset or import.

# Preview legacy import utility

## Delivered scope

The **Settings → Data import** screen accepts the existing anonymized Pulley
XLSX exports directly. It provides isolated staging, validation findings,
per-holder/class balance reconciliation, a downloadable JSON run report,
explicit warning acknowledgment and commit confirmation, and durable run history.
It is **add-only**: no reset, delete, renumber or overwrite action is available.

Preview mode deliberately runs only with `NODE_ENV=development`, the Replit
database provider, and no deployment marker. Published Replit deployments refuse
all staging, history and commit operations. Azure mode uses normal deployment
configuration and ordinary application sign-in described above. Authentication and same-origin
write protection are required in both modes.

## How to use it

1. Open Settings → Data import in **Preview**.
2. Select the six original anonymized exports together:
   - Raw cap table: `StakeholderCompanies`, `Securities`, `ShareClasses`.
   - Shareholder information: `Stakeholders`.
   - Detailed cap table: `C-Common`, `PS-Preferred`, `Ownership`.
   - Standalone `Ownership`.
   - `Securities Granted`.
   - `Grants Outstanding Canceled`.
3. Confirm that all workbooks are fully anonymized. Maximum combined upload is
   5 MB; standard XLSX files only, 3–7 workbooks. Headers are detected within
   sheets rather than assumed to be on a fixed row.
4. Stage and validate. This creates only an import run, not application records.
5. Review errors, warnings, excluded scope and reconciled balances. Blocking
   errors cannot be overridden.
6. Acknowledge warnings and confirm the add-only commit.
7. Open the imported shareholders, Certificates and Audit log. Select the run
   again after refresh to inspect retained validation evidence.

## Mapping and scope rules

- The shareholder-information export defines the selected sample profile scope.
  Its External ID must be nonempty and unique **for this sample converter**.
  Raw technical owner IDs join through `StakeholderCompanies.ExternalId`.
  Names and emails are never used to join owners.
- External ID maps to generation/external ID. Dates of birth/passing and phone
  stay blank when not supplied. The user approved `Stakeholders.Comments` as the
  Family line source; preserve the supplied text, allow blanks, and reject values
  over 200 characters rather than truncate. Retain Comments in notes as well.
  Contact discrepancies are disclosed; the information export takes
  precedence over raw contact metadata.
- Every imported display name is prefixed **SAMPLE —**. Profile notes and
  structured provenance also identify the data as non-production samples.
- Raw securities outside that crosswalk are counted and excluded, not loaded
  with invented owners. Detailed certificates without corresponding profiles
  block the run. This sample scope is **not** a full-company migration.
- Preserve original certificate numbers, positive independent class sequences,
  original quantities, supported issue dates and verified transferred quantities.
  Reject duplicates within scope, class/prefix mismatch and disagreements with
  the detailed cap table.
- Both classes support exact hundredths, including 0.01. Reject higher precision
  instead of rounding. Preserve old calendar dates; do not substitute today.
- Ownership reports are independent controls, never additional positions.
  Current positions derive from certificates; transfers are not added again.
- Partial cancellations, repurchases or unsupported balances block the run
  rather than being misclassified as transfers. Unknown vesting is explicitly
  labeled unknown, not converted into a fully vested assertion.
- Saved formula results may be read as static evidence. No formulas, macros or
  external links execute. Missing cached results stay blank and required-field
  checks apply. ZIP expansion is bounded before workbook parsing.
- SSNs, if supplied in synthetic testing, are encrypted with the application's
  SSN protection before staging. Plaintext values are not stored in reports,
  logs, profile JSON or audit history.

## Optional verified transfer history

The optional history-template download supplies blank **Transfers** and
**Transfer_Allocations** sheets. Supply it as a seventh workbook only when
transaction-level evidence is available. Each event needs a stable legacy key,
recipient certificate, date, quantity and evidence reference. Each allocation
needs the event key, source certificate and quantity.

All sources must have one owner and share class, match the destination, be
affordable and reconcile to the selected certificates' verified transferred
quantities. The converter does not turn raw `TransferredFrom` links alone into
transactions. Without verified rows, it imports certificate summaries and warns
that transaction history is absent.

Historical inserts never invoke live issuance/transfer approvals, notifications
or PDF generation. Unknown historical actors are labeled unknown. The import
operator and actual import time appear separately in shareholder activity and
the centralized Audit log. Counters advance only to numbers actually present
in Preview, preserving any higher existing floors.

## Retention, retries and safety

`legacy_import_runs` retains source filenames/SHA-256 fingerprints, mapping
version, structured normalized staging, findings, reconciliation, operator/time
and commit state. It does not retain source workbook bytes. For these synthetic
tests, original uploads remain the user's chat attachments; the runtime does not
copy them into SharePoint or Azure.

Identical source content, even reordered or renamed, returns the same run.
Changed packages containing existing legacy IDs or certificate numbers block
rather than update them. Commit rechecks conflicts under write locks; all ledger,
counter, history and completion writes share one transaction. Failed commits
leave no partial ledger. Retrying a successful commit returns its recorded result.

Azure mode now supports every signed-in employee and verified SharePoint
originals, including a second integrity check before committing. Actual Azure
hosting, real-data staging and production execution still
require deployment verification and separate approval. Detailed source-row
lineage, historical PDF association and any controlled production reset remain
separate work under the saved migration plan. This does not settle every legacy
status exception.

## Verification

Run `pnpm --filter @workspace/db run test:legacy-import`. The runner creates and
owns a private socket-only PostgreSQL cluster using wholly synthetic workbooks;
it accepts no existing database override and cannot point at Preview or Azure.
