# Shareholder application — destination-first import mapping

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


## shareholders

Import personal information; only name and a stable source link are needed to establish a record. See Shareholder Detail.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | text | PK | NOT NULL |  | Generated / resolved | Yes - utility supplies | Raw cap table / StakeholderCompanies / Id (stable link) | Generate one app ID per stable legacy ID; retain durable crosswalk; never match by name/email. |
| data | jsonb |  | NOT NULL |  | Constructed from profile fields | No - name needed; other profile fields can be blank | See Shareholder Detail | JSON container assembled by utility; employee does not enter JSON. |
| ssn_encrypted | text |  | NULL allowed |  | Optional protected | Yes - NULL when unknown | Shareholder report / Stakeholders / SSN | Encrypt only in Azure using app-compatible mechanism; never put plaintext SSN in JSON, logs, or review files. |
| ssn_last4 | text |  | NULL allowed |  | Derived if SSN known | Yes - NULL when unknown | Derived from verified SSN | Keep consistent with encryption; do not reconstruct missing SSN digits from a masked value. |
| updated_at | timestamp with time zone |  | NOT NULL | now() | Generated timestamp | Yes - system timestamp supplies it | Import operation time / database default | Never describe this as a known legacy modification or approval time. |
| data.name | JSON profile property |  | JSON property, not a separate DB column |  | Required | No | RAW/StakeholderCompanies/Name; PEOPLE/Stakeholders/Name | Text; 1-200 characters; R02-R03; conflicts reviewed, no automatic merges |
| data.generationNumber | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes | RAW/StakeholderCompanies/ExternalId; PEOPLE/Stakeholders/External ID | Text; maximum 100 characters; R01; business field, not the technical PK |
| data.email | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes | RAW/StakeholderCompanies/Email; PEOPLE/Stakeholders/Email | Valid email; maximum 254 characters; R03; blank permitted, conflicts reviewed |
| data.dateOfBirth | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes | Not supplied in current layouts | YYYY-MM-DD; valid calendar date; blank if unknown and optional; R04; no future dates; no inference |
| data.dateOfPassing | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes | Not supplied in current layouts | YYYY-MM-DD; valid calendar date; blank if unknown and optional; R04; not Termination Date; on/after birth if known |
| data.address | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes | PEOPLE/Stakeholders/Address | Text; R03; retain structured staging components |
| data.address (assembled component) | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes | RAW/StakeholderCompanies/City; PEOPLE/Stakeholders/City | Text; R03; review cross-file conflicts |
| data.address (assembled component) | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes | RAW/StakeholderCompanies/State; PEOPLE/Stakeholders/State | Text; R03; assembled full address max 1000 characters |
| data.address (assembled component) | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes | RAW/StakeholderCompanies/ZipCode; PEOPLE/Stakeholders/Zip Code | Text; preserve identifiers and leading zeros; R03; preserve leading zeros and non-US formats |
| data.address (assembled component) | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes | RAW/StakeholderCompanies/Country; PEOPLE/Stakeholders/Country | Text; source country code/name; R03; normalize only through approved code table |
| data.phone | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes | Not supplied in current layouts | Text; maximum 50 characters; R04; preserve international format; never invent |
| data.familyLine | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes | PEOPLE/Stakeholders/Comments | Text; maximum 200 characters; D04; approved Comments-to-Family-line mapping; preserve text, allow blanks, reject overlength; retain notes |
| data.financialNotes | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes | PEOPLE/Stakeholders/Comments | Text; maximum 5000 characters; D04; section 04 notes only after approval; no truncation |
| data.picturePath | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes | Verified picture file in SharePoint; not supplied | Blank until verified file is registered; no photo required to create a shareholder. |
| data.documents[] | JSON profile property |  | JSON property, not a separate DB column |  | Optional | Yes - empty array | Verified document manifest/files; not supplied | Each item: name, objectPath, size. Do not import workbook link text as a verified file. |

## certificates

Import certificate numbers, owners, classes and quantities; preserve evidence, never issue replacement certificates.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | text | PK | NOT NULL |  | Required from source | No | Raw / Securities / CertificateId; cap table / C-Common or PS-Preferred / Certificate ID | Preserve C-n/P-n; resolve duplicate/nonstandard certificate IDs, never silently renumber. |
| sequence_number | integer | Unique (possibly composite) | NOT NULL |  | Derived | Yes - utility supplies | Numeric suffix of certificate ID | Validate positive PostgreSQL integer and agreement with full certificate ID. |
| shareholder_id | text | FK -> shareholders.id | NOT NULL |  | Required relationship | No - source owner must resolve | Raw / Securities / StakeholderId -> StakeholderCompanies.Id | Resolve via stable shareholder crosswalk; unmatched owner is a final-import error, not a reason to request full design samples. |
| share_class | text | Unique (possibly composite) | NOT NULL |  | Required / resolved | No - source class must resolve | Raw / Securities / SecurityClassId -> ShareClasses.Id / Name | Common or Preferred only; verify prefix; sheet name PS-Preferred does not alter P- certificate IDs. |
| quantity | numeric(15, 2) |  | NOT NULL |  | Required from source | No | Raw / Securities / IssuedAmount; cap table / class sheet / Shares Issued | Original issued quantity, not current balance. Fractional Common and Preferred quantities support up to 2 decimal places, including values below one share. Reject excess precision; Azure schema migration is a separate release step. |
| transferred_quantity | numeric(15, 2) |  | NOT NULL | 0 | Derived from verified movements | Conditional - zero only when no transfers are established | Reviewed transfer allocations; cap table / class sheet / Shares Transferred | Default 0 is not permission to erase historical depletion. Raw CancelledAmount may include TRANSFER; do not double-count or assume all depletion is transfer. |
| issue_date | date |  | NULL allowed |  | Optional in DB; conditional for history | Yes for approved unknown-date record; not for date-dependent history | Raw / Securities / IssueDate; cap table / class sheet / Issue Date | Preserve NULL if genuinely unknown; never substitute import date. Live issuance requires a date; history/reports need explicit unknown-date behavior. |
| status | text |  | NOT NULL | 'Outstanding' | Derived from source evidence | Yes - utility derives, not blind default | Raw / Securities / Status plus verified balances/movements | Translate OUTSTANDING / TRANSFERRED / CANCELLED; partial transfers need proven balances. Do not leave every imported certificate Outstanding. |
| vesting_schedule | text |  | NOT NULL |  | Required app value; unknown label can be reviewed | Only with approved 'Legacy vesting not supplied' label | Cap table / class sheet / Vesting Schedule; vesting report / Equity Subject to Vesting / Vesting Schedule | App requires schedule text. Preserve known text; an explicit unknown label is a proposal, not an assumption of fully vested. |
| request_id | text | Unique (possibly composite) | NOT NULL |  | Generated technical key | Yes - utility supplies | No Pulley source needed | Stable import operation key; not an invented live approval request. |
| issued_by | text |  | NOT NULL |  | Import-aware provenance required | Yes - no historic actor need be invented | Historical actor if genuinely available; otherwise unknown | Required DB text must be populated through approved provenance/display behavior; distinguish unknown legacy actor from actual importing employee. |
| created_at | timestamp with time zone |  | NOT NULL | now() | Generated timestamp | Yes - system timestamp supplies it | Import operation time / database default | Never describe this as a known legacy modification or approval time. |

## share_transfers

Import only evidenced transfers; not needed for an approved opening-balances-only approach.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | text | PK | NOT NULL |  | Generated / resolved | Yes - utility supplies | Stable reviewed legacy transaction identifier | Generate one app ID per confirmed movement; retain crosswalk. TransferredFrom is evidence, not a transaction ID. |
| source_certificate_id | text | FK -> certificates.id | NOT NULL |  | Required relationship | No if a transfer is imported | Reviewed parent security / CertificateId | Primary source certificate; for a batch keep all source allocations in sources. |
| sources | jsonb |  | NULL allowed |  | Conditional for batch history | Yes for supported single-source case; no for batch | Reviewed source certificate IDs and allocation quantities | JSON array of certificateId/quantity; same owner/class; allocation sum equals transfer quantity. Do not infer missing batch allocations. |
| recipient_certificate_id | text | FK -> certificates.id; Unique (possibly composite) | NOT NULL |  | Required relationship | No if a transfer is imported | Reviewed child security / CertificateId | Must resolve to existing imported recipient certificate; no new certificate generated during history import. |
| originator_id | text | FK -> shareholders.id | NOT NULL |  | Required relationship | No if a transfer is imported | Reviewed source security owner -> shareholder crosswalk | One source owner per batch; must differ from recipient. |
| recipient_id | text | FK -> shareholders.id | NOT NULL |  | Required relationship | No if a transfer is imported | Reviewed recipient security owner -> shareholder crosswalk | Match the recipient certificate owner. |
| originator_name | text |  | NOT NULL |  | Resolved display value | Yes - utility supplies from resolved profile | Resolved source shareholder name | Do not claim a current imported name is an evidenced historic name snapshot. |
| recipient_name | text |  | NOT NULL |  | Resolved display value | Yes - utility supplies from resolved profile | Resolved recipient shareholder name | Name is for display, not identity matching. |
| share_class | text |  | NOT NULL |  | Required / resolved | No if a transfer is imported | Resolved related certificate class | All source and recipient certificates must agree. |
| quantity | numeric(15, 2) |  | NOT NULL |  | Required from evidence | No if a transfer is imported | Reviewed movement quantity / allocation total | Positive, including below one share for Common or Preferred; within historical availability. Up to 2 decimal places with exact transfer/allocation arithmetic; reject excess precision. |
| transfer_date | date |  | NOT NULL |  | Required from evidence | No if a transfer is imported | Cap table / class sheet / Transfer Date or approved transaction evidence | A cancellation or recipient issue date is not automatically a transfer date. |
| reason | text |  | NOT NULL | '' | Optional | Yes - empty text allowed | Raw / Securities / TransferReason; cap table / class sheet / Transfer Reason | Translate supported reasons; blank remains blank; preserve unknown legacy reason as evidence. |
| attachments | jsonb |  | NOT NULL | '[]'::jsonb | Optional | Yes - defaults to empty array | Verified document manifest / SharePoint files | Register verified file references, not workbook link text or old signed URLs. |
| price_per_share | text |  | NULL allowed |  | Optional | Yes - NULL | Transfer-specific historical price evidence | Never substitute today's Settings price or a grant price. |
| request_id | text | Unique (possibly composite) | NOT NULL |  | Generated technical key | Yes - utility supplies | No Pulley source needed | Stable import operation key; no pending approval is created. |
| request_fingerprint | text |  | NOT NULL |  | Generated technical fingerprint | Yes - utility supplies | Approved normalized movement + source provenance | Idempotent retries; changed content is an explicit conflict. |
| recorded_by | text |  | NOT NULL |  | Import-aware provenance required | Yes - utility records operator separately | Actual import employee; legacy actor only if known | Do not misattribute the historical transfer to the importing employee. |
| created_at | timestamp with time zone |  | NOT NULL | now() | Generated timestamp | Yes - system timestamp supplies it | Import operation time / database default | Never describe this as a known legacy modification or approval time. |

## Other tables — summary only

| Table | Classification | Purpose | Handling | Business input |
| --- | --- | --- | --- | --- |
| certificate_templates | Configured | Blank certificate PDF templates | Upload blank Common/Preferred templates; original completed certificates are not templates. | Set up separately in Settings; no legacy mapping needed. |
| share_price_history | Configured | Dated operational share prices | Finance confirms price and effective date. Historical certificate prices are not automatically current prices. | Set up separately in Settings; no legacy mapping needed. |
| signoffs | Configured | Configured approvers/signatures | Set up authorized signers and signatures separately; shareholders are not employee approvers. | Set up separately in Settings; no legacy mapping needed. |
| certificate_counters | Generated | Next certificate numbers | Set independent Common/Preferred counters from the approved imported/reserved certificate inventory. | No separate source worksheet; the utility/app supplies derived values. |
| certificate_documents | Generated | Completed certificate PDF links | Current schema needs import-aware associations for historical PDFs; missing live approvals/templates are not data the user must recreate. | Original files and reliable certificate/entity links, only if documents are included. |
| settings_audit | Generated | Settings/admin activity log | New actions record actual operators and timestamps. Do not fabricate historic settings changes. | No separate source worksheet; the utility/app supplies derived values. |
| shareholder_activity | Generated | Shareholder activity/history | Create a clearly labeled import summary; import earlier history only when supplied and supported. Do not invent field-level history. | No separate source worksheet; the utility/app supplies derived values. |
| shareholder_uploads | Generated | File registry | Create registry entries after verifying actual SharePoint files. Excel workbooks alone do not contain file bytes. | Original files and reliable certificate/entity links, only if documents are included. |
| certificate_request_templates | Not imported | Template chosen for a live request | App creates links during future live workflows; no legacy approval/template link is required from Pulley. | No legacy data entry; future app/authentication actions create records if needed. |
| company_settings | Not imported | Legacy undated price settings | Retain for app compatibility; current prices are recorded through share_price_history. No Pulley row is needed. | No legacy data entry; future app/authentication actions create records if needed. |
| sessions | Not imported | Employee sign-in sessions | Created by authentication. No migration data entry. | No legacy data entry; future app/authentication actions create records if needed. |
| signoff_email_notifications | Not imported | Approval email delivery queue | Leave empty for migration; no legacy notifications are sent. | No legacy data entry; future app/authentication actions create records if needed. |
| signoff_result_email_notifications | Not imported | Outcome email delivery queue | Leave empty for migration; no legacy notifications are sent. | No legacy data entry; future app/authentication actions create records if needed. |
| transfer_requests | Not imported | Live issuance/transfer approvals | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. | No legacy data entry; future app/authentication actions create records if needed. |
| users | Not imported | Employee sign-in identities | Created through Microsoft Entra sign-in, not from shareholder records. | No legacy data entry; future app/authentication actions create records if needed. |

## Technical reference — supporting-table fields

These fields are retained for implementation reference, not additional business mapping worksheets.


### certificate_counters

Set independent Common/Preferred counters from the approved imported/reserved certificate inventory.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| share_class | text | PK | NOT NULL |  | Derived | Yes - utility supplies | Approved imported Common/Preferred classes | One counter for each class, independent. |
| last_number | integer |  | NOT NULL | 0 | Derived | Yes - utility supplies | Highest approved imported/reserved suffix per class | Set from final authoritative inventory, not these reduced samples. |

### certificate_documents

Current schema needs import-aware associations for historical PDFs; missing live approvals/templates are not data the user must recreate.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | text | PK | NOT NULL |  | Generated | Yes - utility supplies | No source ID required beyond stable document link | Stable import document key after verification. |
| certificate_id | text | FK -> certificates.id; Unique (possibly composite) | NOT NULL |  | Required relationship if PDFs included | No if PDF link is created | Document manifest -> resolved certificate | PDF must be associated with the correct existing imported certificate. |
| request_id | text | FK -> transfer_requests.id; Unique (possibly composite) | NOT NULL |  | Current-schema gap; not a source requirement | Cannot be NULL today; needs import-aware design | No authentic live request expected for legacy PDF | Do not fabricate an approval request. Approve a legacy-document association change. |
| template_id | text | FK -> certificate_templates.id | NOT NULL |  | Current-schema gap; not a source requirement | Cannot be NULL today; needs import-aware design | No current blank template expected for historic original | Do not falsely link an original PDF to today's template. |
| shareholder_id | text |  | NOT NULL |  | Resolved relationship | No if PDF link is created | Resolved certificate holder / evidence | Associate with imported holder; record originator as well when known. |
| originator_id | text |  | NULL allowed |  | Optional relationship | Yes - NULL | Reviewed transfer originator if applicable | Supports both parties' histories; do not guess. |
| transfer_id | text |  | NULL allowed |  | Optional relationship | Yes - NULL | Reviewed legacy transfer crosswalk if applicable | Only link to an evidenced imported transfer. |
| object_path | text |  | NOT NULL |  | Generated after verification | No if PDF link is created | Verified original PDF in SharePoint via storage adapter | Retain original bytes; no regeneration/current signatures. |
| created_at | timestamp with time zone |  | NOT NULL | now() | Generated timestamp | Yes - system timestamp supplies it | Import operation time / database default | Never describe this as a known legacy modification or approval time. |

### certificate_request_templates

App creates links during future live workflows; no legacy approval/template link is required from Pulley.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| request_id | text | PK; FK -> transfer_requests.id | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | App creates links during future live workflows; no legacy approval/template link is required from Pulley. |
| template_id | text | FK -> certificate_templates.id | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | App creates links during future live workflows; no legacy approval/template link is required from Pulley. |

### certificate_templates

Upload blank Common/Preferred templates; original completed certificates are not templates.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | text | PK | NOT NULL |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Upload blank Common/Preferred templates; original completed certificates are not templates. |
| share_class | text | Unique (possibly composite) | NOT NULL |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Upload blank Common/Preferred templates; original completed certificates are not templates. |
| name | text |  | NOT NULL |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Upload blank Common/Preferred templates; original completed certificates are not templates. |
| object_path | text |  | NOT NULL |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Upload blank Common/Preferred templates; original completed certificates are not templates. |
| fields | jsonb |  | NOT NULL |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Upload blank Common/Preferred templates; original completed certificates are not templates. |
| active | boolean |  | NOT NULL | True | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Upload blank Common/Preferred templates; original completed certificates are not templates. |
| created_by | text |  | NOT NULL |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Upload blank Common/Preferred templates; original completed certificates are not templates. |
| created_at | timestamp with time zone |  | NOT NULL | now() | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Upload blank Common/Preferred templates; original completed certificates are not templates. |

### company_settings

Retain for app compatibility; current prices are recorded through share_price_history. No Pulley row is needed.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | text | PK | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Retain for app compatibility; current prices are recorded through share_price_history. No Pulley row is needed. |
| common_price | numeric(24, 6) |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Retain for app compatibility; current prices are recorded through share_price_history. No Pulley row is needed. |
| preferred_price | numeric(24, 6) |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Retain for app compatibility; current prices are recorded through share_price_history. No Pulley row is needed. |
| updated_by | text |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Retain for app compatibility; current prices are recorded through share_price_history. No Pulley row is needed. |
| updated_at | timestamp with time zone |  | NOT NULL | now() | Not imported | N/A - do not create legacy rows | No Pulley source | Retain for app compatibility; current prices are recorded through share_price_history. No Pulley row is needed. |

### sessions

Created by authentication. No migration data entry.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sid | varchar | PK | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Created by authentication. No migration data entry. |
| sess | jsonb |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Created by authentication. No migration data entry. |
| expire | timestamp |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Created by authentication. No migration data entry. |

### settings_audit

New actions record actual operators and timestamps. Do not fabricate historic settings changes.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | text | PK | NOT NULL |  | Generated by actual admin action | No Pulley value needed | Actual operator, action and outcome | App records new actions; do not seed invented historic settings changes. |
| actor_id | text |  | NOT NULL |  | Generated by actual admin action | No Pulley value needed | Actual operator, action and outcome | App records new actions; do not seed invented historic settings changes. |
| actor_name | text |  | NOT NULL |  | Generated by actual admin action | No Pulley value needed | Actual operator, action and outcome | App records new actions; do not seed invented historic settings changes. |
| action | text |  | NOT NULL |  | Generated by actual admin action | No Pulley value needed | Actual operator, action and outcome | App records new actions; do not seed invented historic settings changes. |
| target_id | text |  | NOT NULL |  | Generated by actual admin action | No Pulley value needed | Actual operator, action and outcome | App records new actions; do not seed invented historic settings changes. |
| outcome | text |  | NOT NULL |  | Generated by actual admin action | No Pulley value needed | Actual operator, action and outcome | App records new actions; do not seed invented historic settings changes. |
| changes | jsonb |  | NOT NULL |  | Generated by actual admin action | No Pulley value needed | Actual operator, action and outcome | App records new actions; do not seed invented historic settings changes. |
| detail | text |  | NULL allowed |  | Generated by actual admin action | No Pulley value needed | Actual operator, action and outcome | App records new actions; do not seed invented historic settings changes. |
| created_at | timestamp (3) with time zone |  | NOT NULL | now() | Generated by actual admin action | No Pulley value needed | Actual operator, action and outcome | App records new actions; do not seed invented historic settings changes. |
| completed_at | timestamp with time zone |  | NULL allowed |  | Generated by actual admin action | No Pulley value needed | Actual operator, action and outcome | App records new actions; do not seed invented historic settings changes. |

### share_price_history

Finance confirms price and effective date. Historical certificate prices are not automatically current prices.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | serial | PK | NOT NULL | Database sequence | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Finance confirms price and effective date. Historical certificate prices are not automatically current prices. |
| common | text |  | NULL allowed |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Finance confirms price and effective date. Historical certificate prices are not automatically current prices. |
| preferred | text |  | NULL allowed |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Finance confirms price and effective date. Historical certificate prices are not automatically current prices. |
| effective_date | date |  | NULL allowed |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Finance confirms price and effective date. Historical certificate prices are not automatically current prices. |
| currency | text |  | NOT NULL | 'USD' | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Finance confirms price and effective date. Historical certificate prices are not automatically current prices. |
| recorded_at | timestamp with time zone |  | NOT NULL | now() | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Finance confirms price and effective date. Historical certificate prices are not automatically current prices. |
| recorded_by | text |  | NOT NULL |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Finance confirms price and effective date. Historical certificate prices are not automatically current prices. |
| recorded_by_id | text |  | NULL allowed |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Finance confirms price and effective date. Historical certificate prices are not automatically current prices. |
| reason | text |  | NULL allowed |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Finance confirms price and effective date. Historical certificate prices are not automatically current prices. |

### shareholder_activity

Create a clearly labeled import summary; import earlier history only when supplied and supported. Do not invent field-level history.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | text | PK | NOT NULL |  | Generated import summary / optional genuine legacy history | No Pulley value needed for a new import summary | Actual import event; historic evidence only if supplied | Record operator/time for import, not invented historic profile edits; unavailable historical changes may remain NULL. |
| shareholder_id | text |  | NOT NULL |  | Generated import summary / optional genuine legacy history | No Pulley value needed for a new import summary | Actual import event; historic evidence only if supplied | Record operator/time for import, not invented historic profile edits; unavailable historical changes may remain NULL. |
| name | text |  | NOT NULL |  | Generated import summary / optional genuine legacy history | No Pulley value needed for a new import summary | Actual import event; historic evidence only if supplied | Record operator/time for import, not invented historic profile edits; unavailable historical changes may remain NULL. |
| action | text |  | NOT NULL |  | Generated import summary / optional genuine legacy history | No Pulley value needed for a new import summary | Actual import event; historic evidence only if supplied | Record operator/time for import, not invented historic profile edits; unavailable historical changes may remain NULL. |
| actor | text |  | NOT NULL |  | Generated import summary / optional genuine legacy history | No Pulley value needed for a new import summary | Actual import event; historic evidence only if supplied | Record operator/time for import, not invented historic profile edits; unavailable historical changes may remain NULL. |
| actor_name | text |  | NULL allowed |  | Generated import summary / optional genuine legacy history | No Pulley value needed for a new import summary | Actual import event; historic evidence only if supplied | Record operator/time for import, not invented historic profile edits; unavailable historical changes may remain NULL. |
| changes | jsonb |  | NULL allowed |  | Generated import summary / optional genuine legacy history | No Pulley value needed for a new import summary | Actual import event; historic evidence only if supplied | Record operator/time for import, not invented historic profile edits; unavailable historical changes may remain NULL. |
| created_at | timestamp with time zone |  | NOT NULL | now() | Generated import summary / optional genuine legacy history | No Pulley value needed for a new import summary | Actual import event; historic evidence only if supplied | Record operator/time for import, not invented historic profile edits; unavailable historical changes may remain NULL. |

### shareholder_uploads

Create registry entries after verifying actual SharePoint files. Excel workbooks alone do not contain file bytes.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| object_path | text | PK | NOT NULL |  | Generated after file verification | No if file registry row is created | SharePoint-backed storage adapter | Actual registered application path; no local path or signed URL. |
| owner_id | text |  | NOT NULL |  | Generated technical registration owner | Yes - utility supplies actual import identity | Authorized import process/operator | Do not assume this is the shareholder FK; the target association is recorded separately. |
| name | text |  | NOT NULL |  | Required if files included | No if file registry row is created | Original document manifest / filename | Retain filename safely. |
| content_type | text |  | NOT NULL |  | Verified from file | Yes - process derives | Verified original bytes | MIME validation, not just extension. |
| purpose | text |  | NOT NULL | 'profile' | Generated classification | Yes - process supplies | Approved attachment classification | Existing default profile; signatures/templates must use the correct registration flow. |

### signoff_email_notifications

Leave empty for migration; no legacy notifications are sent.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | text | PK | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| request_id | text | FK -> transfer_requests.id; Unique (possibly composite) | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| signer_id | text | Unique (possibly composite) | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| recipient_email | text |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| app_origin | text |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| status | text |  | NOT NULL | 'Pending' | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| attempts | integer |  | NOT NULL | 0 | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| provider_status | integer |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| failure_code | text |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| created_at | timestamp with time zone |  | NOT NULL | now() | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| updated_at | timestamp with time zone |  | NOT NULL | now() | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| accepted_at | timestamp with time zone |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |

### signoff_result_email_notifications

Leave empty for migration; no legacy notifications are sent.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | text | PK | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| request_id | text | FK -> transfer_requests.id; Unique (possibly composite) | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| recipient_email | text |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| app_origin | text |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| outcome | text |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| status | text |  | NOT NULL | 'Pending' | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| attempts | integer |  | NOT NULL | 0 | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| provider_status | integer |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| failure_code | text |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| created_at | timestamp with time zone |  | NOT NULL | now() | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| updated_at | timestamp with time zone |  | NOT NULL | now() | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |
| accepted_at | timestamp with time zone |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave empty for migration; no legacy notifications are sent. |

### signoffs

Set up authorized signers and signatures separately; shareholders are not employee approvers.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | text | PK | NOT NULL |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Set up authorized signers and signatures separately; shareholders are not employee approvers. |
| name | text |  | NOT NULL |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Set up authorized signers and signatures separately; shareholders are not employee approvers. |
| email | text | Unique (possibly composite) | NOT NULL |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Set up authorized signers and signatures separately; shareholders are not employee approvers. |
| signature_path | text |  | NOT NULL |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Set up authorized signers and signatures separately; shareholders are not employee approvers. |
| email_notifications_enabled | boolean |  | NOT NULL | True | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Set up authorized signers and signatures separately; shareholders are not employee approvers. |
| updated_by | text |  | NOT NULL |  | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Set up authorized signers and signatures separately; shareholders are not employee approvers. |
| updated_at | timestamp with time zone |  | NOT NULL | now() | Setup separately; not legacy conversion | N/A to conversion; setup validates required values | Authorized Settings setup / verified files | Set up authorized signers and signatures separately; shareholders are not employee approvers. |

### transfer_requests

Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | text | PK | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| originator_id | text | FK -> shareholders.id | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| originator_name | text |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| recipient_id | text | FK -> shareholders.id | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| recipient_name | text |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| source_certificate_id | text | FK -> certificates.id | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| kind | text |  | NOT NULL | 'Transfer' | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| required_signers | jsonb |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| approvals | jsonb |  | NOT NULL | '[]'::jsonb | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| issuance | jsonb |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| share_class | text |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| vesting_schedule | text |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| input | jsonb |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| fingerprint | text |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| requested_by | text |  | NOT NULL |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| requester_email | text |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| app_origin | text |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| status | text |  | NOT NULL | 'Pending' | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| ceo_approved_by | text |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| ceo_approved_at | timestamp with time zone |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| cfo_approved_by | text |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| cfo_approved_at | timestamp with time zone |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| rejected_by | text |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| rejected_at | timestamp with time zone |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| completed_transfer_id | text | FK -> share_transfers.id | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| recipient_certificate_id | text | FK -> certificates.id | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |
| created_at | timestamp with time zone |  | NOT NULL | now() | Not imported | N/A - do not create legacy rows | No Pulley source | Leave historical approvals out; do not create pending requests or invent prior approvals. Older CEO/CFO column names do not drive current signer configuration. |

### users

Created through Microsoft Entra sign-in, not from shareholder records.

| Field | Type | Keys | DB rule | Default | Conversion requirement | Source blank? | Proposed source | Treatment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| id | varchar | PK | NOT NULL | gen_random_uuid() | Not imported | N/A - do not create legacy rows | No Pulley source | Created through Microsoft Entra sign-in, not from shareholder records. |
| email | varchar | Unique (possibly composite) | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Created through Microsoft Entra sign-in, not from shareholder records. |
| email_verified | boolean |  | NOT NULL | False | Not imported | N/A - do not create legacy rows | No Pulley source | Created through Microsoft Entra sign-in, not from shareholder records. |
| first_name | varchar |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Created through Microsoft Entra sign-in, not from shareholder records. |
| last_name | varchar |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Created through Microsoft Entra sign-in, not from shareholder records. |
| profile_image_url | varchar |  | NULL allowed |  | Not imported | N/A - do not create legacy rows | No Pulley source | Created through Microsoft Entra sign-in, not from shareholder records. |
| created_at | timestamp with time zone |  | NOT NULL | now() | Not imported | N/A - do not create legacy rows | No Pulley source | Created through Microsoft Entra sign-in, not from shareholder records. |
| updated_at | timestamp with time zone |  | NOT NULL | now() | Not imported | N/A - do not create legacy rows | No Pulley source | Created through Microsoft Entra sign-in, not from shareholder records. |

## JSON structure reference

| Table | JSON column | Structure / treatment |
| --- | --- | --- |
| certificate_templates | fields | Array of fillable PDF field names detected/validated from the uploaded blank template. |
| sessions | sess | Opaque authentication/session object managed by session middleware; not a fixed Pulley data contract; never import it. |
| settings_audit | changes | Array: {field, before, after, protected}. Actual admin action only; not Pulley profile history. |
| share_transfers | sources | Array: {certificateId, quantity}. Required complete allocations for a batch; physical source_certificate_id retains the primary source. |
| share_transfers | attachments | Array: {name, objectPath, size}. Only verified original files. |
| shareholder_activity | changes | Array: {field, before, after, protected}. No SSN values. NULL for unsupported old summaries. |
| shareholders | data | name; email; dateOfBirth; dateOfPassing; address; phone; familyLine; generationNumber; financialNotes; picturePath; documents[]: {name, objectPath, size}. See Shareholder Detail. |
| transfer_requests | required_signers | Array: {id, name, email, signaturePath, emailNotificationsEnabled?}. Live Settings signer snapshots, not legacy import. |
| transfer_requests | approvals | Array of signer snapshot plus {userId, approvedAt}. Live votes only; never fabricate. |
| transfer_requests | issuance | {requestId, shareClass, quantity, issueDate, vestingSchedule}. Live issuance request only. |
| transfer_requests | input | {requestId, recipientId?, newRecipient?: {name, email?}, quantity, transferDate, reason?, pricePerShare?, sources?: [{certificateId, quantity}], attachments?: [{name, objectPath, size}]}. Live transfer payload only. |
