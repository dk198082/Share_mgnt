---
name: Azure object storage uploads
description: Keep Azure SAS credentials server-side and avoid exposing broad storage permissions to browsers.
---

This guidance applies only to legacy Azure migration/rollback operations. The
current product requirement is SharePoint-only file storage; see
[SharePoint storage policy](sharepoint-storage-policy.md).

When Azure storage is configured with a SAS connection string rather than an
account key, proxy browser uploads through the authenticated API. Do not return
the container/account SAS to the browser; validate the employee identity,
registered path, owner, content type, and size before writing.

**Why:** The Azure storage integration was configured with SAS credentials, so
the server could not safely mint a blob-scoped, write-only SAS. Proxied uploads
support that credential model without broadening browser access.

**How to apply:** Use the authenticated API upload path for Azure storage unless
the server can mint a narrowly scoped, short-lived upload SAS without exposing
container-wide credentials.
