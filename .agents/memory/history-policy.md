---
name: Shareholder history policy
description: Completeness, attribution and sensitive-value boundaries for shareholder audit history.
---
The user requires a History tab tracking all changes to shareholder information with who made each change and when.

**Why:** This is the employee-facing record of changes, including profile edits, document/picture changes, certificates, and transfer/approval activity.

**How to apply:** Persist audit entries atomically with successful changes. Failed operations and unchanged saves must not create misleading events. Snapshot employee display names alongside stable identities for new events so later account renaming/deletion does not erase attribution.

Legacy activity summaries must remain visible and explicitly marked summary-only. Never invent historical before/after values from current data.

**Why:** Earlier activity recorded action summaries and employee IDs, but not the old field values. Those differences cannot be reconstructed reliably.

**How to apply:** Make the limitation visible; any directory name resolved for an old entry is a current-directory identity, not an event-time name snapshot.

Never put raw SSN digits, ciphertext, last-four-digit changes, or private storage URLs into history. Record SSN changes using generic protected-value descriptions, and document changes using attachment names/metadata.

**Why:** Historical copies would extend exposure of secured values beyond the current record and cannot be removed by changing the current value.

**How to apply:** Keep protected history generic and read-only; do not introduce reveal controls or compare raw secured values in the browser.
