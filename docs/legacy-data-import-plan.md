# Shareholder Management — Legacy Data Import Plan

**Status:** Initial mapping review was followed by authorization to build and load anonymized samples in Replit Preview. The [Preview utility](legacy-import/preview-utility.md) supports profile-scoped direct-export validation and add-only import. The user subsequently simplified [Azure import access](legacy-import/azure-import-setup.md): anyone signed into the Azure app can use the utility, with no separate import role or activation required. Live Azure execution, reset, real-data import and cutover remain unapproved.

See [the mapping and conversion review package](legacy-import/README.md). The initial review gate preceded the later Preview-only build authorization. That authorization does not permit a production reset, production import, real-data processing in Replit, or cutover. Sample-only behavior must not be mistaken for a completed production migration service.

## Objective

Populate Azure Production from the previous shareholder application, starting with empty application tables rather than merging pilot data. Store structured data in Azure PostgreSQL and files in SharePoint. Provide a controlled Settings import utility that can be retained for future use.

**Confirmed business requirement:** Both Common and Preferred shares support quantities with up to two decimal places, including quantities below one share. Preserve exact quantities throughout issuance, transfers, allocations, approvals, holdings, reports, certificate PDFs and imports. Certificate IDs/counters remain whole-number sequences. Reject excess precision rather than silently rounding or truncating. Runtime support is implemented separately from the importer; Azure needs the reviewed quantity-column migration before fractional production writes.

## Required execution and data boundary

The production importer must execute in Azure. Real legacy data must not be uploaded to or processed by Replit, including its application runtime, workspace, chat attachments, logs, or generated reports.

- Use Replit for code development and synthetic-data tests only.
- Use column definitions and fully anonymized/synthetic example workbooks for mapping design. Masking SSNs alone is insufficient if other real personal details remain.
- Deploy the production import UI/API and background worker, if needed, in Azure before accepting real files. A Replit-hosted API connected to Azure PostgreSQL does not meet this requirement.
- Upload real source files directly to the Azure-hosted service or the approved SharePoint location. Do not route them through Replit endpoints.
- Keep staging records and import-run tracking in Azure PostgreSQL; source workbooks, attachments, and retained reconciliation reports belong in SharePoint with appropriate permissions and retention.
- Keep temporary processing files, error outputs, and application logs within the approved Azure/Microsoft environment. Avoid logging personal field values.
- Reuse existing Microsoft sign-in: every signed-in Azure app user may import, without extra roles or permissions. Keep production credentials in Azure-managed configuration/secrets, not development configuration.
- Disable import execution in the Replit deployment and keep development isolated from the real production dataset.
- Once real data is loaded, user-facing production reads and writes must also use Azure-hosted application services, not the Replit pilot API.

The exact Azure hosting service, deployment pipeline, identity permissions, and isolation controls must be agreed and verified before production execution. This plan does not assert that Azure application hosting is already configured.

## Approval boundaries

- Saving this plan does not authorize code changes, a production reset, an import, file deletion, or cutover.
- First review representative source exports and approve the mapping and historical scope.
- Implementation may then be authorized separately.
- Before executing any destructive operation, reconfirm the exact environment, schema, backup/recovery evidence, and deletion scope.
- Import staging and preview must not change live application records.
- Replit data and existing SharePoint files remain untouched unless separately authorized.

## Inputs needed

- Representative Excel extracts for shareholders, certificates, transfers, and attachment references.
- Column definitions, status descriptions, and available legacy identifiers.
- Final legacy cap table and holdings totals for reconciliation.
- Availability of historical certificates, transfer allocations, PDFs, and other supporting files.
- Decision on full history versus opening balances and an agreed cutoff date.
- Named business reviewers; any signed-in employee may run the import utility.

Provide column definitions or fully anonymized/synthetic examples for design in Replit, preserving consistent synthetic relationship identifiers. Submit actual source exports only through the approved Azure/SharePoint production import path. Do not place real extracts in source control or this chat.

## Workstream A — Source assessment, mapping, and templates

This design work occurs before the production migration steps below.

### A1. Assess existing Excel extracts

Inspect sheet structures, identifiers, date formats, data types, duplicate patterns, certificate statuses, relationships, and available historical coverage. Identify unsupported or missing information; do not infer financial rights or fabricate history.

Prefer accepting existing export formats directly where practical, rather than requiring employees to reformat them manually.

### A2. Produce a mapping for review

Use a destination-first review centered on three mapping tabs: **Shareholders**, **Certificates**, and **Share_Transfers**. Include individual shareholder JSON business fields on Shareholders. Preserve proposed source mappings and required/optional/generated guidance, distinguishing database NOT NULL from required source input. Summarize the remaining tables separately as configured, generated or not imported; retain the complete table/column inventory in the technical reference. Three source-mapped tables do not remove utility responsibilities for counters, import provenance/history and optional historical PDF associations. Small representative examples are enough for design; complete anonymized exports are not a prerequisite for building the utility.

Deliver a source-to-destination mapping with:

| Mapping attribute | Required information |
|---|---|
| Source | Workbook, sheet, column |
| Destination | Application entity and field |
| Conversion | Formatting, status translation, normalization, and other transformations |
| Validation | Required values, constraints, and relationship checks |
| Exceptions | Missing values, duplicates, ambiguities, and proposed handling |
| Review | Business decision and approval status |

Use stable legacy IDs to link entities. Names and email addresses are not unique relationship keys. Treat the legacy generation number as its own business field, not an assumed technical key.

### A3. Produce import templates and instructions

Deliver a downloadable Excel workbook and field definitions with required-field indicators, supported formats, and validation guidance.

| Sheet | Intended contents |
|---|---|
| Shareholders | Legacy ID, personal and contact information, family line, generation number, agreed additional fields |
| Certificates | Certificate number, owner legacy ID, class, issue date, original and remaining quantities, status, vesting information |
| Transfers | Legacy transaction ID, date, source and recipient IDs, destination certificate, quantities, reason |
| Transfer allocations, if needed | Transfer ID, each source certificate, and allocated quantity, preserving multi-certificate batches |
| Documents | Linked entity type and legacy ID, filename, document type, matching file reference |

Finalize sheet layouts from the approved mapping; these are proposed categories, not a frozen schema.

**Gate:** Approve the mapping, exception rules, migration history scope, and templates before implementing the converter.

## Workstream B — Settings import utility and conversion

Create **Settings → Data Import**, available to anyone already signed into the Azure application. Do not add import-specific roles, groups or approvals. Reset remains a separate, explicitly approved operation rather than an app-user permission.

The utility should provide:

- Template and instructions download.
- Source workbook and supporting-file submission.
- Isolated staging, validation, and preview.
- Downloadable error and reconciliation reports.
- Explicit approval and commit of a validated run.
- Import-run history, status, operator, timestamps, and source-file fingerprint.
- Safe retry and duplicate prevention, including a changed file containing previously imported legacy IDs.
- Normal availability in Azure, with an optional IT pause control.

The production reset is a separate controlled operation, not a routine “Delete all data” button.

### Validation

- Required values, dates, supported classes, and numeric formats.
- Duplicate legacy IDs and certificate numbers.
- Missing or ambiguous relationship targets.
- Common `C-` and Preferred `P-` certificate prefixes and independent numbering.
- Nonnegative quantities and balances; transfers within available holdings.
- Consistent ownership, status, transfer chronology, and ending balances.
- Complete source allocations for batch transfers.
- Matching documents, supported types/sizes, and missing or duplicate attachments.
- Protected handling of SSNs: application-compatible encryption, masked previews, and no sensitive values in logs or error reports.

Blocking errors prevent commit. Warnings require explicit review. Never silently correct balances or invent transactions.

### Historical import behavior

- Preserve original certificate numbers, legacy identifiers, and supported historical attribution.
- Distinguish import operator/time from the historical actor/event time.
- Mark incomplete legacy activity as summary-only where appropriate.
- Do not create new approval requests, send notification emails, replay transfers as live actions, or generate replacement certificates for history.
- Preserve original historical PDFs and signatures only when supported by source evidence.
- Do not grant shareholder login access; shareholder engagement remains outside Phase 1.

### Reliability

Keep incomplete runs from appearing as a usable live ledger. Track database and SharePoint progress explicitly because they cannot share a single atomic transaction. Use isolated staging, resumable file verification, idempotent promotion, and a clearly defined recovery boundary. Validate all business constraints before final promotion.

**Gate:** Review implementation and verification results before authorizing production reset or import.

## Workstream C — Production migration runbook

### Step 1. Reset Azure application data

**Execution prerequisite:** Azure hosting and the data boundary above must be verified before reset. The reset tooling must run within the approved Azure environment, not through a Replit-hosted application or workspace.

1. Confirm the exact production connection and application schema before proceeding.
2. Pause writes and prevent normal production use.
3. Take a recovery backup and confirm the recovery procedure is usable.
4. Preserve an inventory of existing file references.
5. Obtain explicit approval for the stated deletion scope.
6. Clear all Shareholder Management application records while preserving the table structure:
   - Shareholders and personal information.
   - Certificates, balances, and counters.
   - Transfers and activity history.
   - Pending requests, approval records, and notification records.
   - Settings, signers, signatures, template registrations, and document references.
   - Other application-owned operational records identified during reset design.
7. Reset the Common and Preferred counters independently.
8. Verify application tables are empty and schema objects remain valid.

**Recommended scope:** Application data in the configured `Shareholdermanagement` schema. Do not drop the entire `d365crm` database or affect other schemas. Preserve database permissions and Microsoft Entra configuration; identify any application session/identity records and access consequences before clearing them.

Do not delete Replit records or existing SharePoint files as part of this step. Import-run tracking must be initialized after reset or stored outside the reset scope.

### Step 2. Confirm final source and cutoff

Obtain the authoritative final exports and agree a cutoff date. Freeze legacy entry at final export, or explicitly capture and reconcile every change through cutover.

- **Full history preferred:** Import historical/current certificates, transfers, shareholders, and supporting documents when reliable.
- **Opening balances alternative:** Import current holdings at cutoff and retain earlier history in an accessible, clearly labeled legacy archive.

### Step 3. Submit final import files

Use approved templates or the approved direct-export converter. Supply supporting files and a document manifest. Retain originals securely; do not commit extracts or file contents to the repository.

### Step 4. Stage and validate

Run all validation rules without modifying live application records. Correct errors and rerun. Retain validation results and reviewed warnings.

### Step 5. Reconcile the proposed import

Compare against legacy evidence:

- Shareholder count.
- Certificate counts by class and status.
- Outstanding Common and Preferred totals.
- Holdings by shareholder.
- Historical transfer and allocation counts.
- Document counts and unmatched files.

For full history, reconcile relationships and movements as well as final balances. Finance approves the proposed import.

### Step 6. Approve and commit

An authorized employee explicitly commits the validated run. Load entities in dependency order and prevent duplicate retries. Preserve certificate numbers; set each class counter so the next new number follows the highest imported certificate number in that class.

Do not trigger live issuance/transfer approval workflows or notifications for imported history.

### Step 7. Verify SharePoint files

Verify each file’s bytes/integrity and entity association. Confirm authorized users can open representative attachments and certificate PDFs through the application. Track failures without exposing partial results as a completed import. Do not regenerate historical PDFs or apply present-day signatures to them.

### Step 8. Configure operational settings

Reconfigure and verify:

- Common and Preferred share prices.
- Required signers and notification preferences.
- Signature images.
- Common and Preferred blank certificate templates.
- Microsoft Entra access and import authorization.

### Step 9. Perform acceptance checks

Run Detailed Cap Table, Shareholder Information Report, and Shareholder Transaction Report. Compare counts and totals with approved exports.

Review representative shareholders, certificate ownership, partial/full transfers, batch allocations, historical activity, file access, and next-number behavior for both share classes.

Finance and the application owner approve the results before production use.

### Step 10. Cut over

Confirm no unreconciled legacy changes exist after the cutoff. Enable production use, keep the previous application read-only, and retain the approved exports, mapping, import receipts, reconciliation reports, and acceptance record securely.

Before normal use begins, a failed migration can return to the approved clean baseline and retry. After new production transactions begin, do not perform a blanket reset without a separate recovery plan.

## Workstream D — Optional future imports

Keep the utility disabled by default after migration. Future use requires explicit permission, staging, validation, reconciliation, and approval.

- Default to add-only.
- Make updates a separate deliberate mode with conflict handling.
- Do not support workbook-driven deletion.
- Retain durable import history and duplicate protection.

## Completion criteria

- Mapping, transformations, exception decisions, templates, and historical scope approved.
- Azure-hosted execution and production application routing verified; Replit import execution disabled and development isolated from real production data.
- Real source files, staging data, reports, and processing never route through Replit.
- Reset executed only after explicit approval and recovery preparation.
- Empty Azure application baseline verified before importing.
- Imported records reconcile with approved legacy totals and relationships.
- SharePoint files verify successfully and open through authorized application access.
- Historical imports do not trigger new approvals, emails, or certificate issuance.
- Both certificate counters are correct.
- Settings restored and Microsoft Entra access verified.
- Retry/recovery behavior demonstrated using non-production test data.
- Business acceptance recorded before production activity.

## Pending decisions

- Two-decimal quantity support is confirmed for both classes; Azure migration/release authorization remains separate.
- Actual export formats and source field mapping.
- Full history versus opening balances.
- Source cutoff and legacy freeze arrangements.
- Authorized import operators and business reviewers.
- Exact reset scope, including operational/session records.
- Backup/recovery procedure and retention policy.
- Azure hosting, deployment process, and enforcement of development/production isolation.
- Whether future imports need update capability in addition to add-only.

## Immediate next action

Review the [destination-first field mapping](legacy-import/destination-first-mapping.md), using the three main workbook tabs: **Shareholders**, **Certificates**, and **Share_Transfers** (historical transfers only when included). The **Other Tables** tab is a supporting summary, not additional source-mapping work. The supplied small examples are enough for this review; do not request a complete anonymized dataset. Approve or revise the field sources and required/blank/generated handling before mapping-dependent implementation. Full final-source reconciliation and real-file processing occur later in the approved Azure environment, never Replit. Production reset and import remain separately approved.
