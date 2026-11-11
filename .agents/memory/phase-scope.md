---
name: Shareholder Management scope
description: User-defined phased scope and handling unspecified fields.
---
Phase 1 is internal management by company employees (HR, Finance): shareholder management, certificate generation and certificate transfer. The initial request focuses on home, left navigation, a filterable shareholder report, and creating/opening records with six sections.

Phase 2 adds shareholder login, personal-information editing and history. Do not implement phase 2 until the user says it has begun.

**Why:** The user explicitly limited work to phase 1.

**How to apply:** Employee authentication belongs to phase 1; shareholder self-service does not. Financial fields beyond notes remain unspecified. See certificate-rules.md for the subsequently defined certificate identity rules.

The user authorized a production data move to Azure PostgreSQL while preserving Preview separately. The published production ledger is authoritative; Preview is to be archived without merging its conflicting ownership records. The user has also separately authorized direct Microsoft Entra sign-in, with no Admin Console or app-role mapping.

**Why:** Replit Production and Preview contain conflicting certificates and balances. The user selected Production as live and Preview as an isolated archive, then explicitly requested Entra authentication without the separate Admin Console authorization step.

**How to apply:** Preserve all production records in the active Azure schema and retain Preview data only in an isolated archive. Keep app behavior and history intact; preserve historical Replit/Clerk identities. All signed-in tenant users have equal app access, and only configured Settings signers may approve.

For the authorized data move, published production is the active ledger; Preview is to be preserved separately in Azure, not merged into live ownership records.

**Why:** The user chose production as authoritative after a comparison found conflicting shareholder and certificate rows between environments.

**How to apply:** Copy production records into the application's active Azure tables. Keep the complete Preview snapshot isolated from live balances/history; never reconcile conflicting certificates automatically.
