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

The administrative Audit Log must provide centralized administrative and shareholder activity while preserving the same events in Shareholder History and Transfer History.

**Why:** The user explicitly requested a company-wide activity view without losing the existing record-specific views.

**How to apply:** Treat centralization as an additional read view, not a move or deletion of source history. Keep attribution, protected-value boundaries, and summary-only limitations consistent across views.

Use UTC calendar days for centralized Audit Log reporting periods, with both selected days included. Display its event times in UTC too.

**Why:** A reporting period must identify the same events for every employee, regardless of their browser timezone or daylight-saving changes. No company-specific reporting timezone was supplied.

**How to apply:** Keep future presets and exports consistent with this convention unless the user explicitly chooses a different reporting timezone. Do not change record-specific histories as part of centralized reporting work.

Never put raw SSN digits, ciphertext, last-four-digit changes, or private storage URLs into history. Record SSN changes using generic protected-value descriptions, and document changes using attachment names/metadata.

**Why:** Historical copies would extend exposure of secured values beyond the current record and cannot be removed by changing the current value.

**How to apply:** Keep protected history generic and read-only; do not introduce reveal controls or compare raw secured values in the browser.
