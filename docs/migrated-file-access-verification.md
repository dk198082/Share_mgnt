# Migrated file access verification

## Attempt — 2026-11-11

**Current target: SharePoint, not Azure Blob Storage.** The user explicitly
corrected the file-storage requirement after the checks below. Azure-based
task wording is superseded; no database-provider change was requested.

**Current status: all 12 production registered/referenced objects passed direct
SharePoint verification. Staff downloads and anonymous denial passed for the
10 files linked in the app. Photo/document categories have no current references
and remain untested. Originals must remain retained; cleanup is not authorized.**

### Published SharePoint release established

The available main-project history contains the existing SharePoint
implementation in commit `4f9d310`, followed by publish commit `8a7894d`.
That publish record names build `b26f8d85-c193-4f12-a5e7-e96e2c9b1b1f`.
The deployment service independently returned that same build as the latest
successful deployment, created at `2026-11-11T05:19:29.463Z` and successful at
`2026-11-11T05:21:26.211Z`, before the operator's browser check.

The corresponding published configuration selects
`OBJECT_STORAGE_PROVIDER=sharepoint` and leaves `DATABASE_PROVIDER=azure`.
Its file service selects `SharePointStoredObjectFile` for reads and writes
without automatic fallback to Azure. It validates file contents against their
SharePoint metadata hashes before delivery.

**Correction to the earlier configuration interpretation:** this task's older
checkout and its environment-variable view still showed `azure`. They did not
represent the newer published SharePoint release. The earlier claim that no
SharePoint implementation existed applied only to the task checkout and was
incorrect for the main project. Existing SharePoint work was located rather
than rebuilt; no deployment or provider setting was changed.

### Direct SharePoint verification — 2026-11-11T06:55:54.447Z

Used the existing main-project `SharePointClient` for read-only Graph requests.
Authentication used the existing application credentials entirely server-side.
File references came from explicit Azure PostgreSQL connections using read-only
transactions, never Preview; the Azure database is separate from Blob Storage.
Only file-reference fields were queried; no shareholder personal details were
retained.

The inventory included upload registrations, completed PDFs, templates,
signers, shareholder photo/document references, transfer attachments, and
captured signer/approval signatures. For each of **12 distinct paths**:

- Read the payload and its `.shareholder-metadata` sidecar from SharePoint.
- Required valid metadata, nonempty bytes, matching actual/declared byte sizes,
  matching SHA-256 hashes, and matching registered MIME type where recorded.
- Counted each path once overall, even when multiple references shared it.

All 12 passed; there were no failures. The reference inventory was collected
again afterward and had not changed. Azure Blob Storage and Replit App Storage
were **not contacted**. No files, metadata, registrations, database records,
settings, or source copies were written or deleted.

| Category | SharePoint paths found | Verified | Failed |
| --- | ---: | ---: | ---: |
| Completed certificate PDFs | 2 | 2 | 0 |
| Certificate templates | 2 | 2 | 0 |
| Signatures | 4 | 4 | 0 |
| Shareholder photos | 0 | 0 | 0 |
| Shareholder documents | 0 | 0 | 0 |
| Transfer attachments | 2 | 2 | 0 |
| Upload registrations | 8 | 8 | 0 |

Rows overlap: registered uploads include signatures and transfer attachments.
The total remains **12**, not the sum of the rows. Ten correspond to the
browser-discovered files below; two additional retained upload registrations
were verified directly in SharePoint but were not separately exercised in the
signed-in browser. No new production records were created to fill absent
photo/document categories.

## Received production results — 2026-11-11

The operator supplied the browser helper's completed JSON summary. The run
started at `2026-11-11T06:39:11.459Z` on the published application and reported
`authenticated: true`, `inventoryComplete: true`, no inventory errors, and no
download failures.

| Category | Unique file URLs in category | Passed | Failed | Coverage |
| --- | ---: | ---: | ---: | --- |
| Completed certificate PDFs | 2 | 2 | 0 | Passed |
| Certificate templates | 2 | 2 | 0 | Passed |
| Signatures | 4 | 4 | 0 | Passed |
| Shareholder photos | 0 | 0 | 0 | No references; untested |
| Shareholder documents | 0 | 0 | 0 | No references; untested |
| Transfer attachments | 2 | 2 | 0 | Passed |

There were **10 distinct file URLs** overall. For each passing file, the
operator-run helper verified a signed-in HTTP 200 response, nonempty bytes,
supported MIME/file header checks, a PDF end marker where applicable, and
recorded attachment sizes where available. It also fetched the same real URL
with credentials omitted and required a JSON 401/403 response. The pasted
browser request messages showed HTTP 401 denial; these were expected anonymous
probes, not signed-in download failures. Some anonymous bodies were canceled
after inspecting status/headers, which can appear as `ERR_ABORTED 401`.

These results are operator-supplied evidence from the signed-in browser, not
an independently authenticated run by the verification browser. They confirm
file delivery through the deployed API and anonymous denial for all ten
API-discovered references. Only sanitized results are recorded here; the
operator's raw console request URLs are not reproduced.

The helper explicitly reported `providerConfirmed: false` and
`cleanupApproved: false`: it does not inspect the serving provider. Subsequent
published-release correlation and direct SharePoint verification are recorded
above. The task-scoped configuration view showing `azure` was an older snapshot,
not evidence that the published app still used Blob Storage.

### Remaining limits

- There were no API-listed photo/document references to exercise. Do not
  manufacture production records or claim these categories passed.
- The browser inventory does not enumerate unlinked upload rows. The subsequent
  database inventory did include every upload registration and verified all 12
  registered/referenced paths directly in SharePoint.
- SharePoint payloads were compared against their stored SHA-256 metadata,
  not re-read from Azure Blob sources or compared to a retained source-migration
  manifest. Full PDF/image parsing was not performed.
- Provider evidence consists of the actual successful published build matching
  the SharePoint release/configuration, plus successful API checks after that
  release and independent SharePoint reads. No live-process environment dump or
  secret/session inspection was performed.
- The two extra unlinked upload registrations were verified directly in
  SharePoint; only the 10 app-linked files were exercised as signed-in API
  downloads and anonymous denials. Their shared storage API route was covered
  by signatures and transfer attachments.
- All source originals remain retained. No deletion, deployment, provider,
  privacy, ledger, or authentication-session changes were made by this
  verification.

The original attempts below are retained as historical observations.

## Initial attempt

Target: `https://shareholder-management.replit.app`, the published application,
not Preview. Deployment metadata reported an active private autoscale deployment
with a successful build. This does not prove that the serving process has
activated the staged Azure storage configuration.

### Observed results

Unauthenticated GET requests, without following redirects, returned:

| Route | HTTP status | Result |
| --- | --- | --- |
| `/api/auth/user` | 307 | Redirect to Replit private-deployment gate |
| `/api/storage/objects/uploads/task-43-nonexistent` | 307 | Redirect to Replit private-deployment gate |
| `/api/certificate-pdfs` | 307 | Redirect to Replit private-deployment gate |
| `/api/settings/certificate-templates` | 307 | Redirect to Replit private-deployment gate |

All four responses had `text/html; charset=utf-8` content type, not application
file responses. The storage probe used an intentionally nonexistent identifier;
it does not demonstrate access or denial for any real migrated object.

An independent browser visit to the published application reached Replit's
“Log in to access a private website” page. The browser had no authorized session.
An authorized sign-in handoff was requested but timed out. No authenticated
application requests were possible.

The outer publishing gate denied these anonymous requests. **API-level denial
has not been verified:** these requests never reached the app's employee
authorization checks. Source inspection shows employee checks on the download
routes, but that is not evidence of their behavior in the deployed API.

### Required download checks

| File category | API download route | Signed-in result |
| --- | --- | --- |
| Completed certificate PDFs | `/api/certificate-pdfs/:id` | Not tested |
| Certificate templates, including retained versions | `/api/settings/certificate-templates/:id/pdf` | Not tested |
| Signature images | `/api/storage/objects/uploads/:id` | Not tested |
| Shareholder photos | `/api/storage/objects/uploads/:id` | Not tested |
| Shareholder documents | `/api/storage/objects/uploads/:id` | Not tested |
| Transfer attachments | `/api/storage/objects/uploads/:id` | Not tested |

No reference counts, successful downloads, byte comparisons, content-type
checks, or PDF/image validations are claimed. The live Azure storage provider
has not been confirmed. No deployment, privacy, data, authentication-session,
or source-object changes were made by this verification attempt.

## Resume safely

1. An authorized operator must complete the published app's Replit privacy
   sign-in and Microsoft Entra staff sign-in in the verification browser.
   Do not send passwords, session cookies, or tokens in chat or save them here.
2. Confirm the serving API uses SharePoint, not Azure Blob Storage and not merely
   that SharePoint secrets are present. Do not publish or change the provider
   without a working implementation and verified destination files.
3. Inventory existing references using authenticated read-only application
   routes. Cover every category above; explicitly record any absent category
   rather than treating it as passed. Do not create production test records.
4. Retrieve referenced files through the ordinary authenticated API routes.
   Record sanitized counts, HTTP status, nonempty length, expected MIME type,
   format validity, and migration-manifest byte/hash comparisons where
   available. Include retained certificate PDFs/templates, not only active
   versions. Never retain file contents or personal identifiers in this report.
5. Using a browser that has passed the publishing gate but has no app session,
   check the same real download URLs return API-level denial with no file bytes.
   Keep that result distinct from a redirect at the publishing gate.
6. Record the actual results here before considering any separately authorized
   source cleanup. Until all required checks pass, retain every Replit original.

## Subsequent observation — redirect mismatch

The operator reported Microsoft Entra error `AADSTS50011`: sign-in was started
on a `.replit.dev` Preview host whose `/api/auth/callback` URL was not registered
in Entra. The callback is derived from the initiating request host; Preview and
the published application therefore need separate exact Web redirect URIs.
Use the published app for this production verification, not Preview.

A fresh deployment metadata check reported **public** visibility, rather than
the private visibility observed above. No privacy setting was changed by this
verification. Anonymous GET requests now reach the application:

| Route | HTTP status | Content type |
| --- | --- | --- |
| `/api/storage/objects/uploads/verification-nonexistent` | 401 | `application/json; charset=utf-8` |
| `/api/certificate-pdfs/verification-nonexistent` | 401 | `application/json; charset=utf-8` |
| `/api/settings/certificate-templates/verification-nonexistent/pdf` | 401 | `application/json; charset=utf-8` |

These deliberately nonexistent identifiers establish anonymous denial at each
download route family before record lookup, not successful retrieval of any
real file. Staff downloads and the serving storage provider remain unverified.
The original private-gate observations above are retained as historical
evidence, not the current access state.

## Retry after callback registration

The operator confirmed adding the redirect URLs. A fresh visit to the published
app reached its public landing page and its “Sign in with Microsoft” action
opened the Microsoft Entra account-entry page. No redirect-mismatch error was
observed at this stage; the callback round trip itself is still untested.

The verification browser had no authenticated staff session. A sign-in handoff
did not produce confirmed completion, and a subsequent read-only observation
still showed the account-entry page. No credentials were entered by the
verifier. All signed-in file checks remain blocked pending authorized employee
sign-in; no source objects or application records were changed.

## Operator-assisted verification

The operator subsequently confirmed staff sign-in in their own browser, but the
verification browser remained unauthenticated and the handoff control was not
visible to the operator. Sessions must not be copied between browsers.

An operator-approved read-only console check is available at
`scripts/verify-migrated-downloads.browser.js`. Copy the entire file into the
developer console of the signed-in published app and run it once. It makes only
same-origin GET requests, inventories the six file categories through the app's
listing APIs (including full sign-off history and retained templates),
deduplicates download URLs, checks response status/MIME, nonempty bytes, basic
file signatures and recorded attachment sizes, then repeats each real download
with credentials omitted to confirm JSON 401/403 denial.

Its output contains only category counts and sanitized failure reasons with
local numeric file indexes, not names, identifiers, file paths, contents, or
session credentials. Copy only the JSON following `FILE CHECK SUMMARY` back
for recording. Browser request logs themselves can contain private URLs and
should not be shared.

The script fails closed on incomplete inventory, refuses external references
and other app origins, limits each response to 25 MiB, and uses request
timeouts. Missing categories are explicitly untested. It does not parse full
PDF/image structures, compare migration hashes, enumerate unreferenced upload
rows, or confirm the serving storage provider; those limitations remain
explicit in its output. It never grants source-cleanup approval.

Local simulated checks passed for all-category downloads, retained templates,
deduplication, missing sign-in, wrong origins, incomplete lists, external paths,
file failures, format/size mismatches and anonymous access failures:

```sh
node --check scripts/verify-migrated-downloads.browser.js
node --test scripts/verify-migrated-downloads.browser.test.mjs
```

At the time the helper was prepared, no operator-run results had been received.
The subsequently received production results are recorded at the top of this
report. Simulated checks validate the helper, not production file access.
