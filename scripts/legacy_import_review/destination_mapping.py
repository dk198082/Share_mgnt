"""Destination-first business review; no record conversion or database access."""
from __future__ import annotations

import json
from pathlib import Path

from openpyxl.styles import PatternFill

from build_review import DOCS, OUTPUT, document_html, newbook, rowsheet
from review_spec import FIELDS, alias_for

CORE_TABLES = ("shareholders", "certificates", "share_transfers")
CORE_SHEETS = ("Shareholders", "Certificates", "Share_Transfers")


TABLES = {
    "shareholders": ("Shareholder records", "Import", "Import personal information; only name and a stable source link are needed to establish a record. See Shareholder Detail."),
    "certificates": ("Certificate ledger", "Import", "Import certificate numbers, owners, classes and quantities; preserve evidence, never issue replacement certificates."),
    "share_transfers": ("Completed transfer history", "If history is included", "Import only evidenced transfers; not needed for an approved opening-balances-only approach."),
    "shareholder_activity": ("Shareholder activity/history", "App-generated import summary", "Create a clearly labeled import summary; import earlier history only when supplied and supported. Do not invent field-level history."),
    "shareholder_uploads": ("File registry", "If files are included", "Create registry entries after verifying actual SharePoint files. Excel workbooks alone do not contain file bytes."),
    "certificate_documents": ("Completed certificate PDF links", "If original PDFs are included", "Current schema needs import-aware associations for historical PDFs; missing live approvals/templates are not data the user must recreate."),
    "certificate_counters": ("Next certificate numbers", "Derived by utility", "Set independent Common/Preferred counters from the approved imported/reserved certificate inventory."),
    "share_price_history": ("Dated operational share prices", "Configure in Settings", "Finance confirms price and effective date. Historical certificate prices are not automatically current prices."),
    "company_settings": ("Legacy undated price settings", "No legacy import recommended", "Retain for app compatibility; current prices are recorded through share_price_history. No Pulley row is needed."),
    "signoffs": ("Configured approvers/signatures", "Configure in Settings", "Set up authorized signers and signatures separately; shareholders are not employee approvers."),
    "certificate_templates": ("Blank certificate PDF templates", "Configure in Settings", "Upload blank Common/Preferred templates; original completed certificates are not templates."),
    "users": ("Employee sign-in identities", "Not imported from Pulley", "Created through Microsoft Entra sign-in, not from shareholder records."),
    "sessions": ("Employee sign-in sessions", "Not imported from Pulley", "Created by authentication. No migration data entry."),
    "transfer_requests": ("Live issuance/transfer approvals", "Not imported for completed history", "Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration."),
    "certificate_request_templates": ("Template chosen for a live request", "Not imported for completed history", "App creates links during future live workflows; no legacy approval/template link is required from Pulley."),
    "signoff_email_notifications": ("Approval email delivery queue", "Not imported", "Leave empty for migration; no legacy notifications are sent."),
    "signoff_result_email_notifications": ("Outcome email delivery queue", "Not imported", "Leave empty for migration; no legacy notifications are sent."),
    "settings_audit": ("Settings/admin activity log", "App-generated", "New actions record actual operators and timestamps. Do not fabricate historic settings changes."),
}

# Column-specific instructions distinguish required source data from app metadata.
# Format: source requirement, source may be blank?, proposed source, treatment.
OVERRIDES = {
    ("shareholders", "id"): ("Generated / resolved", "Yes - utility supplies", "Raw cap table / StakeholderCompanies / Id (stable link)", "Generate one app ID per stable legacy ID; retain durable crosswalk; never match by name/email."),
    ("shareholders", "data"): ("Constructed from profile fields", "No - name needed; other profile fields can be blank", "See Shareholder Detail", "JSON container assembled by utility; employee does not enter JSON."),
    ("shareholders", "ssn_encrypted"): ("Optional protected", "Yes - NULL when unknown", "Shareholder report / Stakeholders / SSN", "Encrypt only in Azure using app-compatible mechanism; never put plaintext SSN in JSON, logs, or review files."),
    ("shareholders", "ssn_last4"): ("Derived if SSN known", "Yes - NULL when unknown", "Derived from verified SSN", "Keep consistent with encryption; do not reconstruct missing SSN digits from a masked value."),
    ("certificates", "id"): ("Required from source", "No", "Raw / Securities / CertificateId; cap table / C-Common or PS-Preferred / Certificate ID", "Preserve C-n/P-n; resolve duplicate/nonstandard certificate IDs, never silently renumber."),
    ("certificates", "sequence_number"): ("Derived", "Yes - utility supplies", "Numeric suffix of certificate ID", "Validate positive PostgreSQL integer and agreement with full certificate ID."),
    ("certificates", "shareholder_id"): ("Required relationship", "No - source owner must resolve", "Raw / Securities / StakeholderId -> StakeholderCompanies.Id", "Resolve via stable shareholder crosswalk; unmatched owner is a final-import error, not a reason to request full design samples."),
    ("certificates", "share_class"): ("Required / resolved", "No - source class must resolve", "Raw / Securities / SecurityClassId -> ShareClasses.Id / Name", "Common or Preferred only; verify prefix; sheet name PS-Preferred does not alter P- certificate IDs."),
    ("certificates", "quantity"): ("Required from source", "No", "Raw / Securities / IssuedAmount; cap table / class sheet / Shares Issued", "Original issued quantity, not current balance. Fractional Common and Preferred quantities support up to 2 decimal places, including values below one share. Reject excess precision; Azure schema migration is a separate release step."),
    ("certificates", "transferred_quantity"): ("Derived from verified movements", "Conditional - zero only when no transfers are established", "Reviewed transfer allocations; cap table / class sheet / Shares Transferred", "Default 0 is not permission to erase historical depletion. Raw CancelledAmount may include TRANSFER; do not double-count or assume all depletion is transfer."),
    ("certificates", "issue_date"): ("Optional in DB; conditional for history", "Yes for approved unknown-date record; not for date-dependent history", "Raw / Securities / IssueDate; cap table / class sheet / Issue Date", "Preserve NULL if genuinely unknown; never substitute import date. Live issuance requires a date; history/reports need explicit unknown-date behavior."),
    ("certificates", "status"): ("Derived from source evidence", "Yes - utility derives, not blind default", "Raw / Securities / Status plus verified balances/movements", "Translate OUTSTANDING / TRANSFERRED / CANCELLED; partial transfers need proven balances. Do not leave every imported certificate Outstanding."),
    ("certificates", "vesting_schedule"): ("Required app value; unknown label can be reviewed", "Only with approved 'Legacy vesting not supplied' label", "Cap table / class sheet / Vesting Schedule; vesting report / Equity Subject to Vesting / Vesting Schedule", "App requires schedule text. Preserve known text; an explicit unknown label is a proposal, not an assumption of fully vested."),
    ("certificates", "request_id"): ("Generated technical key", "Yes - utility supplies", "No Pulley source needed", "Stable import operation key; not an invented live approval request."),
    ("certificates", "issued_by"): ("Import-aware provenance required", "Yes - no historic actor need be invented", "Historical actor if genuinely available; otherwise unknown", "Required DB text must be populated through approved provenance/display behavior; distinguish unknown legacy actor from actual importing employee."),
    ("share_transfers", "id"): ("Generated / resolved", "Yes - utility supplies", "Stable reviewed legacy transaction identifier", "Generate one app ID per confirmed movement; retain crosswalk. TransferredFrom is evidence, not a transaction ID."),
    ("share_transfers", "source_certificate_id"): ("Required relationship", "No if a transfer is imported", "Reviewed parent security / CertificateId", "Primary source certificate; for a batch keep all source allocations in sources."),
    ("share_transfers", "sources"): ("Conditional for batch history", "Yes for supported single-source case; no for batch", "Reviewed source certificate IDs and allocation quantities", "JSON array of certificateId/quantity; same owner/class; allocation sum equals transfer quantity. Do not infer missing batch allocations."),
    ("share_transfers", "recipient_certificate_id"): ("Required relationship", "No if a transfer is imported", "Reviewed child security / CertificateId", "Must resolve to existing imported recipient certificate; no new certificate generated during history import."),
    ("share_transfers", "originator_id"): ("Required relationship", "No if a transfer is imported", "Reviewed source security owner -> shareholder crosswalk", "One source owner per batch; must differ from recipient."),
    ("share_transfers", "recipient_id"): ("Required relationship", "No if a transfer is imported", "Reviewed recipient security owner -> shareholder crosswalk", "Match the recipient certificate owner."),
    ("share_transfers", "originator_name"): ("Resolved display value", "Yes - utility supplies from resolved profile", "Resolved source shareholder name", "Do not claim a current imported name is an evidenced historic name snapshot."),
    ("share_transfers", "recipient_name"): ("Resolved display value", "Yes - utility supplies from resolved profile", "Resolved recipient shareholder name", "Name is for display, not identity matching."),
    ("share_transfers", "share_class"): ("Required / resolved", "No if a transfer is imported", "Resolved related certificate class", "All source and recipient certificates must agree."),
    ("share_transfers", "quantity"): ("Required from evidence", "No if a transfer is imported", "Reviewed movement quantity / allocation total", "Positive, including below one share for Common or Preferred; within historical availability. Up to 2 decimal places with exact transfer/allocation arithmetic; reject excess precision."),
    ("share_transfers", "transfer_date"): ("Required from evidence", "No if a transfer is imported", "Cap table / class sheet / Transfer Date or approved transaction evidence", "A cancellation or recipient issue date is not automatically a transfer date."),
    ("share_transfers", "reason"): ("Optional", "Yes - empty text allowed", "Raw / Securities / TransferReason; cap table / class sheet / Transfer Reason", "Translate supported reasons; blank remains blank; preserve unknown legacy reason as evidence."),
    ("share_transfers", "attachments"): ("Optional", "Yes - defaults to empty array", "Verified document manifest / SharePoint files", "Register verified file references, not workbook link text or old signed URLs."),
    ("share_transfers", "price_per_share"): ("Optional", "Yes - NULL", "Transfer-specific historical price evidence", "Never substitute today's Settings price or a grant price."),
    ("share_transfers", "request_id"): ("Generated technical key", "Yes - utility supplies", "No Pulley source needed", "Stable import operation key; no pending approval is created."),
    ("share_transfers", "request_fingerprint"): ("Generated technical fingerprint", "Yes - utility supplies", "Approved normalized movement + source provenance", "Idempotent retries; changed content is an explicit conflict."),
    ("share_transfers", "recorded_by"): ("Import-aware provenance required", "Yes - utility records operator separately", "Actual import employee; legacy actor only if known", "Do not misattribute the historical transfer to the importing employee."),
    ("certificate_counters", "share_class"): ("Derived", "Yes - utility supplies", "Approved imported Common/Preferred classes", "One counter for each class, independent."),
    ("certificate_counters", "last_number"): ("Derived", "Yes - utility supplies", "Highest approved imported/reserved suffix per class", "Set from final authoritative inventory, not these reduced samples."),
    ("shareholder_uploads", "object_path"): ("Generated after file verification", "No if file registry row is created", "SharePoint-backed storage adapter", "Actual registered application path; no local path or signed URL."),
    ("shareholder_uploads", "owner_id"): ("Generated technical registration owner", "Yes - utility supplies actual import identity", "Authorized import process/operator", "Do not assume this is the shareholder FK; the target association is recorded separately."),
    ("shareholder_uploads", "name"): ("Required if files included", "No if file registry row is created", "Original document manifest / filename", "Retain filename safely."),
    ("shareholder_uploads", "content_type"): ("Verified from file", "Yes - process derives", "Verified original bytes", "MIME validation, not just extension."),
    ("shareholder_uploads", "purpose"): ("Generated classification", "Yes - process supplies", "Approved attachment classification", "Existing default profile; signatures/templates must use the correct registration flow."),
    ("certificate_documents", "id"): ("Generated", "Yes - utility supplies", "No source ID required beyond stable document link", "Stable import document key after verification."),
    ("certificate_documents", "certificate_id"): ("Required relationship if PDFs included", "No if PDF link is created", "Document manifest -> resolved certificate", "PDF must be associated with the correct existing imported certificate."),
    ("certificate_documents", "request_id"): ("Current-schema gap; not a source requirement", "Cannot be NULL today; needs import-aware design", "No authentic live request expected for legacy PDF", "Do not fabricate an approval request. Approve a legacy-document association change."),
    ("certificate_documents", "template_id"): ("Current-schema gap; not a source requirement", "Cannot be NULL today; needs import-aware design", "No current blank template expected for historic original", "Do not falsely link an original PDF to today's template."),
    ("certificate_documents", "shareholder_id"): ("Resolved relationship", "No if PDF link is created", "Resolved certificate holder / evidence", "Associate with imported holder; record originator as well when known."),
    ("certificate_documents", "originator_id"): ("Optional relationship", "Yes - NULL", "Reviewed transfer originator if applicable", "Supports both parties' histories; do not guess."),
    ("certificate_documents", "transfer_id"): ("Optional relationship", "Yes - NULL", "Reviewed legacy transfer crosswalk if applicable", "Only link to an evidenced imported transfer."),
    ("certificate_documents", "object_path"): ("Generated after verification", "No if PDF link is created", "Verified original PDF in SharePoint via storage adapter", "Retain original bytes; no regeneration/current signatures."),
}


def policy(table, column):
    if (table, column) in OVERRIDES:
        return OVERRIDES[table, column]
    _, mode, purpose = TABLES[table]
    if mode.startswith("Not imported") or mode == "No legacy import recommended":
        return ("Not imported", "N/A - do not create legacy rows", "No Pulley source", purpose)
    if mode == "Configure in Settings":
        return ("Setup separately; not legacy conversion", "N/A to conversion; setup validates required values", "Authorized Settings setup / verified files", purpose)
    if table == "shareholder_activity":
        return ("Generated import summary / optional genuine legacy history", "No Pulley value needed for a new import summary", "Actual import event; historic evidence only if supplied", "Record operator/time for import, not invented historic profile edits; unavailable historical changes may remain NULL.")
    if table == "settings_audit":
        return ("Generated by actual admin action", "No Pulley value needed", "Actual operator, action and outcome", "App records new actions; do not seed invented historic settings changes.")
    if column in ("created_at", "updated_at"):
        return ("Generated timestamp", "Yes - system timestamp supplies it", "Import operation time / database default", "Never describe this as a known legacy modification or approval time.")
    raise ValueError(f"Missing explicit field treatment: {table}.{column}")


def column_rows(catalog):
    result = []
    for table in catalog["tables"]:
        name = table["name"]
        foreign = {}
        for fk in table["foreignKeys"].values():
            for src, dest in zip(fk["columnsFrom"], fk["columnsTo"]):
                foreign[src] = fk["tableTo"] + "." + dest
        unique = {c["name"] for c in table["columns"].values() if c.get("isUnique")}
        for key in table["uniqueConstraints"].values():
            unique.update(key["columns"])
        for idx in table["indexes"].values():
            if idx["isUnique"]:
                unique.update(c["expression"] for c in idx["columns"] if not c["isExpression"])
        for col in table["columns"].values():
            requirement, blank, source, treatment = policy(name, col["name"])
            keys = []
            if col["primaryKey"]:
                keys.append("PK")
            if col["name"] in foreign:
                keys.append("FK -> " + foreign[col["name"]])
            if col["name"] in unique:
                keys.append("Unique (possibly composite)")
            default = col.get("default", "")
            if col["type"] == "serial" and not default:
                default = "Database sequence"
            result.append([
                name, col["name"], col["type"], "; ".join(keys),
                "NOT NULL" if col["notNull"] else "NULL allowed",
                str(default), requirement, blank, source, treatment, "", "",
            ])
    return result


def shareholder_rows():
    source_fields = [f for f in FIELDS["Shareholders"] if f["field"] not in {
        "legacy_shareholder_id", "ssn", "entity_type", "relationship", "termination_date",
    }]
    targets = {
        "name": "data.name", "external_id": "data.generationNumber",
        "email": "data.email", "date_of_birth": "data.dateOfBirth",
        "date_of_passing": "data.dateOfPassing", "address_line": "data.address",
        "city": "data.address (assembled component)", "state": "data.address (assembled component)",
        "postal_code": "data.address (assembled component)", "country": "data.address (assembled component)",
        "phone": "data.phone", "family_line": "data.familyLine", "notes": "data.financialNotes",
    }
    rows = []
    for f in source_fields:
        rows.append([
            "shareholders", targets[f["field"]], "Required" if f["field"] == "name" else "Optional",
            "No" if f["field"] == "name" else "Yes",
            f["source"], f["format"] + "; " + f["rule"], "", "",
        ])
    rows.extend([
        ["shareholders", "data.picturePath", "Optional", "Yes", "Verified picture file in SharePoint; not supplied", "Blank until verified file is registered; no photo required to create a shareholder.", "", ""],
        ["shareholders", "data.documents[]", "Optional", "Yes - empty array", "Verified document manifest/files; not supplied", "Each item: name, objectPath, size. Do not import workbook link text as a verified file.", "", ""],
        ["shareholders", "ssn_encrypted / ssn_last4", "Optional protected", "Yes - NULL", "PEOPLE / Stakeholders / SSN", "Stored outside data JSON; encryption and masked display in Azure only.", "", ""],
    ])
    return rows


def core_mapping_rows(fields, detail, table):
    """Keep all physical core fields and expose profile properties for review."""
    rows = [row[:] for row in fields if row[0] == table]
    if table == "shareholders":
        for row in detail:
            if row[1] == "ssn_encrypted / ssn_last4":
                continue  # Both physical protected columns are already listed.
            rows.append([
                table, row[1], "JSON profile property", "",
                "JSON property, not a separate DB column", "",
                row[2], row[3], row[4], row[5], "", "",
            ])
    return rows


def supporting_rows(catalog):
    rows = []
    for table in catalog["tables"]:
        name = table["name"]
        if name in CORE_TABLES:
            continue
        purpose, mode, guidance = TABLES[name]
        if mode == "Configure in Settings":
            category = "Configured"
            action = "Set up separately in Settings; no legacy mapping needed."
        elif name in {"certificate_counters", "shareholder_activity", "settings_audit",
                      "shareholder_uploads", "certificate_documents"}:
            category = "Generated"
            action = ("Original files and reliable certificate/entity links, only if documents are included."
                      if name in {"shareholder_uploads", "certificate_documents"}
                      else "No separate source worksheet; the utility/app supplies derived values.")
        else:
            category = "Not imported"
            action = "No legacy data entry; future app/authentication actions create records if needed."
        rows.append([name, category, purpose, guidance, action])
    return sorted(rows, key=lambda r: ({"Configured": 0, "Generated": 1, "Not imported": 2}[r[1]], r[0]))


def json_rows(catalog):
    """All JSON columns are inventoried, including app-managed opaque payloads."""
    shapes = {
        ("shareholders", "data"): "name; email; dateOfBirth; dateOfPassing; address; phone; familyLine; generationNumber; financialNotes; picturePath; documents[]: {name, objectPath, size}. See Shareholder Detail.",
        ("shareholder_activity", "changes"): "Array: {field, before, after, protected}. No SSN values. NULL for unsupported old summaries.",
        ("settings_audit", "changes"): "Array: {field, before, after, protected}. Actual admin action only; not Pulley profile history.",
        ("sessions", "sess"): "Opaque authentication/session object managed by session middleware; not a fixed Pulley data contract; never import it.",
        ("certificate_templates", "fields"): "Array of fillable PDF field names detected/validated from the uploaded blank template.",
        ("share_transfers", "sources"): "Array: {certificateId, quantity}. Required complete allocations for a batch; physical source_certificate_id retains the primary source.",
        ("share_transfers", "attachments"): "Array: {name, objectPath, size}. Only verified original files.",
        ("transfer_requests", "required_signers"): "Array: {id, name, email, signaturePath, emailNotificationsEnabled?}. Live Settings signer snapshots, not legacy import.",
        ("transfer_requests", "approvals"): "Array of signer snapshot plus {userId, approvedAt}. Live votes only; never fabricate.",
        ("transfer_requests", "issuance"): "{requestId, shareClass, quantity, issueDate, vestingSchedule}. Live issuance request only.",
        ("transfer_requests", "input"): "{requestId, recipientId?, newRecipient?: {name, email?}, quantity, transferDate, reason?, pricePerShare?, sources?: [{certificateId, quantity}], attachments?: [{name, objectPath, size}]}. Live transfer payload only.",
    }
    result = []
    for table in catalog["tables"]:
        for col in table["columns"].values():
            if col["type"] == "jsonb":
                result.append([table["name"], col["name"], shapes[table["name"], col["name"]]])
    return result


INTRO = """# Shareholder application — destination-first import mapping

**Proposed mappings for review. No full anonymized dataset is required to design or build the utility.**

The current code defines **18 tables and 162 database columns**, not 17 tables. This is an offline reading of the application's schema, not a claim that the live Azure database has been inspected.

## A simpler review

The main workbook has **three source-mapping tabs**, in load order: **Shareholders**, **Certificates**, and **Share_Transfers**. Shareholders includes the individual profile fields inside its JSON container, so no separate technical profile tab is needed.

The other **15 tables** are summarized in **Other Tables** as **Configured**, **Generated**, or **Not imported**. You do not need to map Pulley fields to each of these. The complete 18-table/162-column inventory is retained in this document's technical reference, not mixed into the primary workbook review.

These are the three source-mapped business tables, not a promise that the utility writes only three physical tables. It must also initialize independent Common/Preferred certificate counters, retain truthful import history/provenance, and register original SharePoint document associations if PDFs are included. Historical PDF associations still need the separately reviewed import-aware design; never fabricate live approvals/templates.

If historical transfers are included, retain the older source certificates and former holders they reference, not only today's outstanding positions. Import completed movements through the historical path, not by replaying live issuance/transfer workflows or sending approval emails.

A database-required field does not necessarily require source data. For example, the utility can supply internal IDs, timestamps, fingerprints, certificate suffixes and resolved relationship links. You do not need to manufacture these in Pulley.

| Classification | What you need to provide |
|---|---|
| Required from source | A business fact, such as shareholder name or original certificate quantity |
| Required relationship | A stable source reference that resolves, such as the owner of a certificate |
| Optional / blank allowed | May remain blank or NULL; no invented dates, family lines, SSNs or historical prices |
| Derived / generated | The utility creates or resolves the value; no manual source column needed |
| Setup separately | Configure prices, signers and blank certificate templates through Settings |
| Not imported | Leave operational session, approval and email-delivery history out of the conversion |

**NULL versus blank:** the workbook separately shows database nullability and whether a source value may be omitted. A NOT NULL text column may technically accept an empty string, but the app can still require a meaningful value. Conversely, a NOT NULL timestamp with a default need not come from Pulley. “N/A” means no legacy row is created, not that every required column in that table becomes NULL.

## Minimum information to establish records

- **Shareholder:** name plus a stable legacy shareholder identifier to preserve links. Email, phone, birth/passing dates, family line, address, notes, picture and SSN can be absent.
- **Certificate:** unique certificate number, resolvable owner, class, original quantity and enough evidence to establish its current balance/status. Suffixes, internal request keys and timestamps are generated. Vesting text requires a known value or an approved explicit unknown label. Issue date is nullable in the database, but missing-date behavior must be agreed for historical chronology and reports; live issuance still requires a date.
- **Historical transfer, only if included:** source certificate(s), resolvable source/recipient owners, recipient certificate, quantity, date and complete allocations for batches. Reason, price and attachments can be absent. Do not invent a historical transfer to fill missing data.
- **Documents, only if included:** real original files and reliable entity links. The utility derives verified storage paths and file metadata. Existing historical PDF associations need an import-aware model; you do not have to recreate old approval requests or blank templates.

**Confirmed requirement: both Common and Preferred must support fractional shares**, including quantities below one share, with up to **2 decimal places**. This applies to ongoing issuance, full/partial/batch transfers, allocations, approvals, holdings, reports, certificate PDFs and imports. Preserve exact values with no silent rounding or truncation; reject excess precision. Certificate numbering stays integer-based. Runtime support is implemented separately from the importer; the reviewed Azure quantity-column migration must be applied before fractional production writes. A complete anonymized dataset is not required.

## The utility can still be built this way

After this field mapping is reviewed, build the reusable **Settings → Data Import** utility around it: file intake, automatic agreed conversions, relationship resolution, staging, required-field checks, a preview/error list, approved commit and import-run history. Future add-only imports can use the same reviewed rules.

Small synthetic linked fixtures are sufficient for development and tests. A complete final dataset, matching totals and actual document files are needed only for final migration validation in the approved Azure environment. Reduced design samples are not expected to reconcile to full-company totals.

Initial reset, real-data import and cutover each remain separately approved. This deliverable changes documentation only; no application endpoint, database record or file store was changed.

## Workbook guide

- **Start Here:** scope, load order and review instructions.
- **Shareholders:** the physical shareholder fields and individual profile properties; required/optional guidance, proposed sources and review columns.
- **Certificates:** every certificate field, including IDs, original quantities, issue dates, status and generated values.
- **Share_Transfers:** every historical transfer field, including required links, quantities/dates and conditional batch allocations.
- **Other Tables:** a concise summary of the 15 configured, generated or non-imported tables.
- **Source Guide:** aliases and filenames for the supplied example exports.

Use **Your Changes** and **Review** on the three mapping tabs. Yellow cells are for your comments; they are not additional source-data requirements. Complete technical column and JSON references remain below for the implementation team.

The source aliases refer to the already supplied layouts: RAW = raw cap table; PEOPLE = shareholder information report; CAP = detailed cap table; VEST = vesting report. No source personal rows are reproduced.
"""


def markdown_table(headers, rows):
    def cell(v):
        return str(v).replace("|", "/").replace("\n", " ")
    return "\n".join([
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
        *["| " + " | ".join(cell(v) for v in row) + " |" for row in rows],
    ])


def build_destination(output=OUTPUT, document_dir=DOCS):
    output.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((DOCS / "destination-schema.json").read_text())
    if {t["name"] for t in catalog["tables"]} != set(TABLES):
        raise ValueError("Schema table set changed: review table classifications before generating.")
    fields = column_rows(catalog)
    detail = shareholder_rows()
    supporting = supporting_rows(catalog)
    primary = {table: core_mapping_rows(fields, detail, table) for table in CORE_TABLES}
    physical_count = sum(1 for r in fields if r[0] in CORE_TABLES)
    wb = newbook()
    wb.properties.title = "Shareholder Application - Destination-first Field Mapping"
    rowsheet(wb, "Start Here", ["Topic", "Guidance"], [
        ["Start with", "Review Shareholders, Certificates, then Share_Transfers. These are the three source-mapped business tables, in logical load order."],
        ["Scope", f"Three core tables with {physical_count} physical columns plus individual shareholder profile properties. The other 15 tables are summarized in Other Tables. Full 18-table / 162-column technical reference is retained in the companion document; no live database was queried."],
        ["Samples", "A small representative/anonymized sample is enough for mapping design. No complete anonymized dataset is requested."],
        ["Database versus source", "DB NOT NULL does not mean Pulley must supply it. IDs, timestamps, fingerprints and resolved relationships can be generated by the utility."],
        ["Blank", "NULL allowed describes the DB. Source May Be Blank describes conversion. N/A means do not create a legacy row."],
        ["Required facts", "Shareholder name and a stable source link; certificate number/owner/class/quantity and balance evidence; transfer facts only if history is included."],
        ["Review", "Use Your Changes and Review columns to propose different sources or blank/default behavior. No review entry authorizes execution."],
        ["Supporting tables", "Other Tables groups configured, generated and non-imported tables. Counters/import history are utility responsibilities, not additional Pulley worksheets."],
        ["Historical scope", "Transfers require their older source certificates and former holders. Import completed history without replaying live workflows or sending approval emails."],
        ["Original PDFs", "Optional document manifest and actual files are separate from the three data mappings. Retain originals in SharePoint; import-aware historical links still need review. Do not invent approvals/templates."],
        ["Fractional shares", "Both Common and Preferred support up to 2 decimal places, including below one share, across normal workflows and import. Reject excess precision; no rounding."],
        ["Still pending", "Azure quantity-column migration/release and historical PDF import associations remain separate. The importer itself is not implemented."],
        ["Source names", "RAW/Raw = raw cap table; PEOPLE = shareholder report; CAP/cap table = detailed cap table; VEST = vesting report. Source Guide lists actual filenames."],
        ["Execution", "Mapping-dependent code remains paused. Real data stays in Azure/SharePoint. No reset/import without separate approval."],
    ], {1: 30, 2: 125})
    headers = ["Table", "Database Field", "Type", "Keys", "DB Nullability", "DB Default",
               "Conversion Requirement", "Source May Be Blank?", "Proposed Source",
               "Utility / Conversion Treatment", "Your Changes", "Review"]
    for table, title in zip(CORE_TABLES, CORE_SHEETS):
        ws = rowsheet(wb, title, headers, primary[table],
                      {1: 25, 2: 35, 3: 24, 4: 40, 5: 35, 6: 22, 7: 42, 8: 55, 9: 75, 10: 100, 11: 55, 12: 25})
        ws.freeze_panes = "C2"
        ws.sheet_properties.tabColor = "1D3B2C"
        for row in ws.iter_rows(min_row=2, min_col=11, max_col=12):
            for cell in row:
                cell.fill = PatternFill("solid", fgColor="FFF2CC")
    rowsheet(wb, "Other Tables", ["Table", "Classification", "Purpose", "How It Is Handled", "Business Input Needed"],
             supporting, {1: 42, 2: 22, 3: 40, 4: 105, 5: 100})
    sources = json.loads((DOCS / "source-assessment.json").read_text())
    rowsheet(wb, "Source Guide", ["Alias", "Uploaded Filename", "Sheets", "Proposed Role"],
             [[alias_for(f["file"])[0], f["file"], "; ".join(s["sheet"] for s in f["sheets"]),
               alias_for(f["file"])[1]] for f in sources["files"]], {2: 90, 3: 90, 4: 75})
    path = output / "Shareholder_App_Table_Field_Mapping.xlsx"
    wb.save(path)
    md = INTRO
    mapping_headers = ["Field", "Type", "Keys", "DB rule", "Default", "Conversion requirement",
                       "Source blank?", "Proposed source", "Treatment"]
    for table in CORE_TABLES:
        md += "\n\n## " + table + "\n\n" + TABLES[table][2] + "\n\n"
        md += markdown_table(mapping_headers, [r[1:10] for r in primary[table]])
    md += "\n\n## Other tables — summary only\n\n" + markdown_table(
        ["Table", "Classification", "Purpose", "Handling", "Business input"], supporting)
    md += "\n\n## Technical reference — supporting-table fields\n\nThese fields are retained for implementation reference, not additional business mapping worksheets.\n"
    for table in catalog["tables"]:
        if table["name"] in CORE_TABLES:
            continue
        md += "\n\n### " + table["name"] + "\n\n" + TABLES[table["name"]][2] + "\n\n"
        md += markdown_table(
            mapping_headers,
            [r[1:10] for r in fields if r[0] == table["name"]])
    md += "\n\n## JSON structure reference\n\n" + markdown_table(
        ["Table", "JSON column", "Structure / treatment"], json_rows(catalog)) + "\n"
    document_dir.mkdir(parents=True, exist_ok=True)
    (document_dir / "destination-first-mapping.md").write_text(md)
    html = document_html(md).replace(
        "Shareholder Management — Legacy Import Design Review",
        "Shareholder Application — Table and Field Mapping")
    (output / "Shareholder_App_Table_Field_Mapping.html").write_text(html)
    return path


if __name__ == "__main__":
    print(build_destination())
