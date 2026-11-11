---
name: Disposable database isolation
description: Why migration tests must not accept a configurable database target, even a local one.
---
Keep disposable migration tests independent of application database connection settings. Do not replace their owned cluster with a configurable URL or rely only on a localhost check.

**Why:** Preview's real Replit database can also be local. A local address or test-named schema alone does not establish that destructive test fixtures are isolated from application data.

**How to apply:** When extending migration testing, retain a freshly initialized private cluster, a private socket, fictional records, and explicit cleanup. Test convenience must not permit selecting an existing application database.
