# Shareholder Management
## Application Overview

**Business and technical reference · Phase 1 · Prepared 12 November 2026**

This overview describes the application in the current project source, its principal business rules, and its intended operating boundaries. It is not a certification of the currently published build or a live environment audit. Configuration and deployment status should be verified before a production cutover.

## How to use this document

- **Business users and process owners:** start with sections 1–5 for scope, navigation, day-to-day processes, reports, and controls.
- **Technical leads and support teams:** use sections 6–10 for architecture, integrations, data models, security, operations, and known boundaries.
- **Migration owners:** read section 11 before supplying legacy data or scheduling a reset.

## 1. Purpose and scope

Shareholder Management is an internal application for company employees, principally HR and Finance, to maintain shareholder information, administer Common and Preferred shares, issue certificates, process transfers, retain supporting documents, and review activity.

| Scope | Position |
| --- | --- |
| Phase 1 — employee operations | Current focus: registry, certificate holdings, issuance, transfers, sign-offs, documents, reporting, and audit history. |
| Phase 2 — shareholder engagement | Not started. Shareholder login, self-service profile editing, and personal history access are outside the current scope until explicitly authorized. |
| Pilot information | Fictional pilot data is not the authoritative source for the future real-data migration. |
| Future production import | Planned Azure-hosted utility, subject to mapping review, implementation, and execution approval. |

### Key concepts

| Term | Meaning in this application |
| --- | --- |
| Shareholder | Person whose profile and certificate holdings are recorded. This is distinct from an employee who signs into the application. |
| Certificate | Numbered ledger record representing issued shares of one class held by one shareholder. |
| Holdings | Available shares derived from certificate records and their transferred quantities, not manually entered totals on the profile. |
| Request | Proposed issuance or transfer awaiting the captured set of named signers. A request is not a completed transaction. |
| Sign-off | An authenticated, recorded decision by a configured signer. Uploading a signature image alone is not approval. |
| Transfer | Completed movement of shares from one shareholder to another, with a newly numbered recipient certificate. |
| Audit activity | Recorded evidence of an application event. “Recorded” does not necessarily mean a pending transaction completed. |

## 2. Navigation and key features

| Application area | What users can do |
| --- | --- |
| Home | Open the employee dashboard and navigate to registry operations. |
| Shareholders | Search/filter existing shareholders, create records, and open or edit a shareholder’s details and history. |
| Certificates | Search certificates across shareholders and identify their holder, share class, balance, and status. |
| Transfer History | Look up completed transfers centrally without opening individual shareholders first. |
| Reports | Generate downloadable Excel workbooks for the three supported reports. |
| Pending Sign Off Requests | Review issuance and transfer requests, open request details, and record eligible decisions. |
| Settings | Maintain share prices, named signers, certificate templates, and the centralized Audit log; manage the available pilot-data function. |

Settings sits near the bottom of the left navigation above the signed-in employee. Share prices belong within Settings rather than a separate primary menu item.

### Shareholder record

The record is organized into six sections:

1. **Picture:** shareholder photograph.
2. **Shareholder information:** name, email, date of birth, date of passing, protected SSN, address, and phone.
3. **Family line information:** family line and generation/external identifier.
4. **Shareholder Information:** the renamed fourth section, retaining the current notes-oriented content rather than assuming new financial fields or rights.
5. **Holdings – Shares:** Common and Preferred certificate breakdown, quantities, dates, statuses, and issuance/transfer actions.
6. **Documents:** supporting file attachments, including drag-and-drop upload.

A separate **History** tab shows recorded changes and relevant transaction activity for that shareholder. Sensitive SSN values are not exposed as before/after audit content.

## 3. Key business processes

### 3.1 Create or update a shareholder

1. Find the person in Shareholders before creating a duplicate.
2. Create a new record or open an existing one.
3. Enter or amend personal, contact, family-line, and notes information; add a photograph or documents as needed.
4. Save the record.
5. Use History to review the recorded actor, time, and available field changes. Older summary-only events remain summaries; missing historical details are not reconstructed.

### 3.2 Issue shares and retain a certificate

1. Ensure the applicable Common or Preferred PDF template is available in Settings.
2. Configure the named signers and their signature images.
3. Open the shareholder’s holdings and submit an issuance request for the selected class, quantity, issue date, and vesting information.
4. Eligible signers review the request in Pending Sign Off Requests.
5. On final approval, the system executes the issuance and allocates the next certificate number for that share class.
6. The completed certificate PDF includes recorded approval signatures and is retained with the associated records and history.

Common certificates use **C-1, C-2, …** and Preferred certificates use **P-1, P-2, …**. The two classes have independent counters; a Common issuance does not consume a Preferred number.

### 3.3 Transfer shares

1. Open the source shareholder and select the certificate or certificates to transfer from.
2. Confirm the current holder, displayed first on the form.
3. Choose an existing recipient or provide a new recipient for creation on successful execution.
4. Specify allocations, transfer date, reason, and supporting attachments. The new form defaults Price per Share from Settings for the selected class; review any edited price before submitting.
5. If the transfer crosses family lines, the form displays a notice. This is informational, not a block.
6. Submit the request for sign-off.
7. At final approval, available balances are rechecked and the transfer is committed with a new recipient certificate.
8. Review the result in Transfer History and in both shareholders’ histories.

**Batch transfers** consolidate allocations from multiple certificates belonging to **one source shareholder and one share class** into **one new recipient certificate**. Common and Preferred shares are not combined into a mixed-class certificate.

Transfer reasons include Death, Divorce, Donation, Gift, Secondary Sale, Transfer to Affiliate, and Other.

### 3.4 Review and decide a request

- Sign-off rights come from **Settings → Sign-offs**, not CEO/CFO roles.
- A request captures its required signers. All required eligible signers must approve, in any order.
- The authenticated sign-in address must match the captured signer address. A request link alone grants no approval rights.
- A submitter who is also an eligible signer may approve their own request.
- Approve opens an explicit confirmation popup; it does not immediately execute a decision.
- To change request details, reject and resubmit rather than altering the approved payload.
- Pending requests do **not** reserve shares, allocate certificate numbers, or create proposed recipients.
- Final approval checks current availability under lock. A competing transaction can make a previously submitted request no longer executable.

**Request states:** Pending → Completed, or Pending → Rejected. Partial approvals leave the request pending.

### 3.5 Manage templates, signatures, and files

Settings retains class-specific editable blank certificate PDFs. Completed PDFs are separate transaction evidence, not replacements for the blank templates. Historical completed PDFs and recorded signatures should remain intact when settings change.

SharePoint is the required destination for normal application files: photographs, shareholder documents, transfer attachments, signer images, certificate templates, and generated PDFs. File references and business metadata remain in PostgreSQL. Application access to files goes through authenticated API operations.

## 4. Reports and activity review

### Excel reports

| Report | Business purpose |
| --- | --- |
| Detailed Cap Table | Review ownership as of a selected date, including Summary, Ownership, Common, Preferred, Voting Ownership, and Notes sheets. |
| Shareholder Information Report | Export current profile and contact information; this is not a historical profile reconstruction. |
| Shareholder Transaction Report | Review issued certificates and completed transfers with running balances through the selected as-of date, for all shareholders or one shareholder. Pending/rejected requests are excluded. |

Reports are generated as **.xlsx** workbooks. SSNs are masked; exports should still be handled as confidential because other shareholder information may be present. Example spreadsheets defined the intended formats, not authority to invent data or financial rights.

Cap-table fully diluted figures count recorded shares one for one; the application does not assume options or conversions. Untracked authorized limits, voting rights, options, and capital contributions remain blank with explanatory notes rather than fabricated values.

### Three complementary history views

| View | Intended use |
| --- | --- |
| Settings → Audit log | Company-wide review combining administrative and shareholder activity. |
| Shareholder → History | Review one shareholder’s changes and associated activity. |
| Transfer History | Find completed transfers and their related evidence across the registry. |

The centralized Audit log is an additional read view over existing event sources. It does not replace or remove the record-level histories.

Audit entries are collapsed by default with a readable summary and expandable detail. Users can search, filter by category, select a **UTC recorded-date range**, and page to older entries. Both selected boundary days are included; an omitted boundary is unbounded. Recorded dates differ from a transaction’s business-effective date.

Categories cover administration, shareholder changes, issuance, transfers, approvals, and documents. Administrative outcomes can show pending, failed, or completed operations. Shareholder activity labeled “Recorded” confirms an event was logged, not that an underlying request is complete. Both sides of a transfer can produce related shareholder events.

## 5. Business controls and important limitations

| Control | Why it matters |
| --- | --- |
| Certificate-backed holdings | Balances reflect certificate activity rather than unrelated manually maintained totals. |
| Independent class numbering | Common and Preferred maintain distinct, sequential identities. |
| Transactional ledger execution | Final approval and the ledger mutation succeed together or roll back together. |
| Retry protection | Repeating an operation with the same request identity does not intentionally issue a second certificate or repeat the transfer. |
| Captured signers and decisions | Approval evidence records the specific person and time rather than inferring approval from an uploaded image. |
| Preserved original quantities | Full and partial transfers retain the original issued quantity and track what moved. |
| Retained evidence | Completed certificate PDFs and supporting documents remain associated with the relevant transaction/history. |
| Historical honesty | Unknown actors, missing issue dates, and old summary-only events are not filled with invented detail. |

This overview does not assert that the application is a general accounting system, a legal share-register certification service, or a compliant electronic-signature service. Legal requirements, retention periods, and formal financial controls need separate business approval.

## 6. Technical architecture

**Logical flow:** Employee browser → React web application → authenticated Express API → PostgreSQL business records and SharePoint files.

Microsoft Entra provides employee identity. Outlook sends optional workflow notifications through the connected mailbox. These integrations have different authentication and operational responsibilities.

| Layer | Current implementation |
| --- | --- |
| Web client | React, Vite, TypeScript; registry, settings, reports, history, and workflow screens. |
| API | Node.js / Express 5 with server-side authentication and business-rule enforcement. |
| API contract | OpenAPI specification, generated client hooks/types, and Zod validation. |
| Persistence | PostgreSQL with Drizzle ORM; provider selected by configuration. |
| Production database target | Azure PostgreSQL, database `d365crm`, application schema `Shareholdermanagement`, subject to the configured target. |
| Development/pilot data | Replit PostgreSQL can be used for synthetic Preview data; it is not the source for the future real-data import. |
| File storage | SharePoint via Microsoft Graph for the approved normal upload/download path. |
| Notifications | Microsoft Outlook connector, with database-tracked notification attempts and outcomes. |
| Repository | pnpm workspace with separate web/API artifacts and shared contract/database packages. |

Database location is not the same as application hosting location. A Replit-hosted API connected to Azure still processes data in Replit. The approved future real-data boundary therefore requires Azure-hosted application/import processing, not only an Azure database connection.

## 7. Integrations and dependencies

| Integration | Purpose | Operational considerations |
| --- | --- | --- |
| Microsoft Entra ID | Tenant-specific employee sign-in through OpenID Connect. | Uses `CLIENT_ID`, `CLIENT_SECRET`, and `TENANT_ID`; exact callback registration and tenant configuration must match the environment. No separate Admin Console authorization or app-role mapping is used. |
| Azure PostgreSQL | Structured shareholder, certificate, request, transfer, configuration, and audit records. | Uses `DATABASE_PROVIDER=azure` and the `AZURE_PG_*` configuration family. Preserve the configured schema and TLS requirements. |
| SharePoint / Microsoft Graph | Application file storage in the configured site, library, and root folder. | Uses `OBJECT_STORAGE_PROVIDER=sharepoint`, `SHAREPOINT_*` settings, and application credentials. Site/library permissions are separate from employee OIDC sign-in. Normal operations must not depend on Azure Blob fallback. |
| Microsoft Outlook | Private request and result notifications. | Current implementation uses the connected Outlook mailbox through the Replit connector. An Azure-only deployment needs an approved replacement or verified connector availability there. |

Each captured signer has an email-notification preference. Request notifications contain minimal information and an authenticated link rather than shareholder details or other signers’ addresses. Result notifications go to the captured requester. Sending happens after the business transaction commits.

Mailbox acceptance is **not proof of delivery**. Failed/uncertain sends are tracked; an uncertain outcome must not be blindly retried because the message may already have been sent. The in-app queue remains the primary place to find pending work. Teams notifications are not described as an implemented channel.

## 8. Data model

### Business relationships

- One shareholder can hold many certificates.
- A certificate belongs to one shareholder and one share class.
- A transfer connects an originator, a recipient, source certificate allocations, and a newly issued recipient certificate.
- The request entity handles **both issuance and transfer**, despite its physical table name `transfer_requests`.
- Requests capture signer requirements and decisions; completed documents link the request, certificate, and template.
- Shareholder activity and administrative audit records provide complementary event history.
- Document metadata points to file content in SharePoint; PostgreSQL does not serve as the primary file-byte store.

<!-- CONCEPTUAL_MODEL -->

### Physical table groups

| Group | Tables | Main responsibility |
| --- | --- | --- |
| Registry and record history | `shareholders`, `shareholder_activity`, `shareholder_uploads` | Profile data, protected SSN storage, change history, and upload ownership/metadata. |
| Certificate ledger | `certificates`, `certificate_counters` | Ownership, original and transferred quantities, statuses, and independent class counters. |
| Workflow and transfers | `transfer_requests`, `share_transfers` | Proposals, captured approvals, issuance payloads, transfer allocations, attachments, and completed transaction links. |
| Certificate evidence | `certificate_templates`, `certificate_request_templates`, `certificate_documents` | Class templates, request/template linkage, and retained generated PDF metadata. |
| Configuration | `company_settings`, `signoffs`, `share_price_history` | Current prices, named signers, and dated price reference history. |
| Administration history | `settings_audit` | Administrative actions, actor snapshots, outcomes, and available changes. |
| Notification tracking | `signoff_email_notifications`, `signoff_result_email_notifications` | Request and requester-result delivery state, attempts, and failure/uncertain outcomes. |
| Authentication support | `sessions`, `users` | Server-side sessions and legacy identity records; the legacy user table is not the current tenant authorization list. |

The schema combines relational tables with JSONB payloads. For example, shareholder profile attributes live in `shareholders.data`; captured signers, approvals, and batch allocations are not all separate normalized child tables. A business relationship is not necessarily a database-enforced foreign key.

<!-- LOGICAL_MODEL -->

**Model references:** Existing Conceptual Data Model, Logical Data Model Summary, Logical Data Model Detailed, and the combined Shareholder Application Models document remain companion references. Their diagrams are design snapshots; the current Drizzle schema and reviewed migrations govern exact table/column definitions.

### Important modeling details for technical leads

- Certificate primary IDs are the visible C-/P- numbers, with a unique class/sequence combination.
- Certificate states include Outstanding, Partially Transferred, Transferred, and Cancelled.
- Batch source allocations are represented in JSON alongside the primary source-certificate link.
- Historic names, signer details, and actor names may be snapshots, intentionally different from a subsequently edited profile.
- Legacy CEO/CFO-named columns remain for compatibility; they do not define current approval policy.
- Notification tracking and upload metadata are operational records, not proof that an external system completed an action.
- Database changes and SharePoint file operations cannot be assumed to share one atomic transaction; recovery must reconcile both systems.

## 9. Identity, privacy, and access

Current employee sign-in is tenant-specific Microsoft Entra OIDC with server-side sessions. The application validates the tenant and uses the Entra object ID for new employee attribution. Historical Clerk/Replit actors and prior approvals are preserved rather than automatically merged by email.

**Access boundary:** every successfully authenticated account in the configured tenant currently receives the same application access. There is no separate application Administrator allowlist or current role mapping. Named approval rights remain narrower and are matched to Settings signers. This broad tenant-access policy should be reviewed before introducing real shareholder information.

SSNs are encrypted using AES-256-GCM with a domain-separated key derived from `SESSION_SECRET`. Normal APIs expose only the last four digits. Preserve that secret: changing it without an appropriate migration can make existing encrypted SSNs unreadable. Session, token, password, and secret values do not belong in documents, logs, exports, or audit change text.

Authenticated file access and sensitive-data protections must remain in place even if the project or deployment is public. Public project visibility is not an authorization mechanism for private business files. Uploaded signature images are sensitive evidence, not authentication credentials.

## 10. Operations, maintenance, and support

### Source-of-truth locations

| Location | Use |
| --- | --- |
| `artifacts/shareholder-management/src/` | Web screens, navigation, forms, and generated-client usage. |
| `artifacts/api-server/src/` | API routes, authentication integration, business rules, documents, storage, and notifications. |
| `lib/api-spec/openapi.yaml` | Shared HTTP API contract. |
| `lib/db/src/schema/` | Current Drizzle table definitions. |
| `lib/db/migrations/` | Reviewed, versioned Azure schema migrations. |
| `docs/models/` | Independent conceptual, logical-summary, and logical-detailed SVG diagrams. |

### Release and recovery considerations

- Separate synthetic Preview work from production operations.
- Review the actual deployment configuration and target schema before applying changes; repository defaults alone do not prove production behavior.
- Use the reviewed Azure migration workflow rather than a development schema push against production.
- Protect shareholder rows, certificates, transfer balances, approval evidence, SSN encryption material, and referenced SharePoint files as a connected recovery set.
- Define backup schedules, restore tests, retention, monitoring, and business ownership before real-data go-live; this overview does not certify those controls as configured.
- Confirm real sign-in, signer matching, upload/download access, template availability, issuance/transfer PDF retention, notification behavior, and report reconciliation in the approved target environment.
- Audit search improvements have synthetic performance checks; these are not production latency guarantees or authorization to add production indexes.

### Common support checks

| Symptom | First checks |
| --- | --- |
| Employee cannot sign in | Entra tenant/callback configuration, credential validity, and any separate hosting entry gate. |
| Signed-in person cannot approve | Captured signer address versus the Entra-returned address; request status; whether the person already decided. |
| Request requires a certificate template | Applicable Common/Preferred template availability and readable file reference in the active environment. |
| Final approval cannot complete | Remaining source balances, competing completed transfers, unchanged request details, and required evidence. |
| File cannot open or upload | SharePoint provider, application permissions, configured site/library/root, object metadata, and API authentication. |
| Email not received | Signer preference, connector access, notification state, and mailbox delivery; continue using the in-app queue. |
| Records differ between environments | Database provider, configured schema, pilot-versus-production dataset, and the deployed build. |

### Companion operational documents

- `docs/azure-entra-readiness.md` — identity behavior and callback setup.
- `docs/azure-data-cutover.md` — earlier pilot database-copy/cutover evidence; not the authority for a future real-data import.
- `docs/azure-schema-migrations.md` — controlled schema changes and drift checks.
- `docs/sharepoint-file-storage.md` — SharePoint storage configuration and migration considerations.
- `docs/migrated-file-access-verification.md` — scope and evidence of prior file-access checks.
- `docs/audit-search-performance.md` — audit-query test and benchmark interpretation.
- `docs/shareholder-application-models.html` — companion model document.

## 11. Planned legacy import and Azure-only boundary

The proposed import utility would populate Azure Production from the previous shareholder application. It is **not yet an implemented Settings function**, and no reset or import is authorized by this overview.

1. Agree the Azure hosting, access, isolation, backup, and recovery arrangements.
2. Obtain explicit execution approval to clear the application-owned target data and start empty. Prefer a scoped application-schema reset; do not drop a potentially shared database.
3. Assess the legacy exports and historical completeness.
4. Design source-to-target mappings, import templates, and conversion rules for business review.
5. Validate staged records, certificate numbers, owners, quantities, and references; produce actionable errors and reconciliation totals.
6. Run the approved import, retain reliable legacy history without fabricating missing detail, and reconcile the results.
7. Accept the migrated data, test operations, and cut over in the approved Azure environment.

**Real data must not be uploaded to this chat, the Replit workspace, or a Replit-hosted importer.** Development here uses fully anonymized or synthetic examples and column definitions only. Actual imports, reset tooling, staging, and subsequent real-data application processing must run in Azure, with files in SharePoint.

The future plan leaves Replit pilot data behind rather than treating it as the authoritative legacy seed. Historical import must not trigger fresh approval emails, imply new approvals, or manufacture completed certificate PDFs. Source cleanup needs separate approval.

See `docs/legacy-data-import-plan.md` for the editable proposal and approval gates.

## 12. Ownership and document maintenance

Suggested business ownership is HR/Finance for profile quality, holdings reconciliation, signer policy, and acceptance of reports. Suggested technical ownership is the application/IT team for identity, deployment, database changes, SharePoint permissions, secrets, recovery, and monitoring. These are recommended responsibilities, not assigned named owners.

Update this overview whenever scope, approval policy, access policy, storage, data structures, or hosting changes materially. Keep business explanations aligned with the implemented behavior; mark proposals separately from delivered features.

**Editable source:** `docs/shareholder-application-overview.md`  
**Shareable document:** `docs/shareholder-application-overview.html`  
**Regeneration:** `node scripts/generate-application-overview.mjs`
