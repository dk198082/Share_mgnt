---
name: SharePoint storage policy
description: User's storage-provider requirement, Graph upload-session behavior, and verification across older task snapshots.
---

## Product requirement

Application uploads and generated files must use SharePoint, not require an
Azure Blob storage account. This includes certificate PDFs, templates,
signatures and attachments. Moving file storage does not authorize moving the
PostgreSQL ledger or changing Microsoft Entra sign-in.

**Why:** The user explicitly requested SharePoint-only file uploads to remove the
Azure storage-account dependency.

**How to apply:** Do not reintroduce an Azure fallback for normal file operations.
Keep old copies until the user separately authorizes cleanup, and preserve
existing records and history links during storage transitions.

## Graph session behavior

Use the parent DriveItem ID when creating an upload session. A root-relative
session address returned `400 invalidRequest` in this tenant, whereas the
parent-item address succeeded.

**Why:** Live migration encountered this difference despite working root-relative
folder lookups. A diagnostic session also left a zero-byte placeholder before
any payload was committed.

**How to apply:** Treat empty placeholders as unverified, not successful copies.
Do not overwrite or delete conflicting destinations unless ownership is proven.
Session recovery must distinguish its own incomplete uploads from existing files.

## Verification across task snapshots

An older task checkout and its environment-variable view are not proof of the
currently published file-storage provider.

**Why:** A verification checkout retained Azure-only code and settings even
though the main project already contained and had published the SharePoint
cutover. Treating the older settings as live incorrectly contradicted the user's
SharePoint requirement.

**How to apply:** Check available main-project history before reimplementing a
missing adapter. Correlate the actual successful deployment build with its
published code/configuration, and verify SharePoint copies directly using
read-only access. Do not copy user sessions or alter provider settings just to
work around an older task snapshot.
