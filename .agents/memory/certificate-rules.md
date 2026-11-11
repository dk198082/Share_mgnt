---
name: Certificate business rules
description: User-required certificate identity rules and current limits of dilution calculations.
---
Certificates are integral to the shareholder Holdings - Shares section. Common IDs are C-1, C-2, etc.; Preferred IDs are P-1, P-2, etc. Each class has its own company-wide sequential counter, starting at 1 and increasing by 1 per new certificate. Numbers are not per shareholder.

**Why:** The user explicitly required unique IDs with separate Common and Preferred counters, and supplied a table showing Certificate, Issue Date, Status, Vesting Schedule, Fully Diluted, and % Fully Diluted.

**How to apply:** Preserve assigned IDs and independent class sequences across future certificate generation, transfers and imports. Never use shareholder-local numbering or combine the two counters.

A transfer generates a new certificate for the recipient in the same share class, using that class's counter. Retain linked transfer history on both originator and recipient records. Keep the original certificate's issued quantity; a partial transfer reduces its remaining balance and marks it Partially Transferred, while a full transfer marks it Transferred with zero remaining.

**Why:** The user requested new certificate numbers and updated statuses on both owners' records. The supplied transfer form includes a quantity bounded by available shares, so the implemented initial policy supports partial as well as full transfers without creating a separate remainder certificate.

**How to apply:** Preserve the original certificate and its history, conserve company-wide shares, and carry share class and vesting into the recipient certificate. Do not silently replace this policy with cancellation/reissuance of the remainder; confirm a business-rule change first.

Transfers may consolidate quantities from multiple certificates owned by one source shareholder into exactly one certificate for a different recipient. A batch contains one share class only; keep Common and Preferred separate. Preserve every source allocation in approvals and history, rather than treating the whole quantity as coming from the first certificate.

**Why:** The user requested batch transfers with one recipient certificate and explicitly selected “One source shareholder.”

**How to apply:** Use one signed request and an atomic finalization for the whole batch, with no partial execution when a source is unavailable. Preserve partial balances and verify that reports count the recipient's consolidated certificate once. Do not merge different vesting terms without an explicit business-rule decision.

Full and partial transfers, and new certificate issuances, require approval from all named signers configured in Settings → Sign Offs. A submitter may approve their own request when their verified login email matches a required signer.

**Why:** The user replaced CEO/CFO role approvals with Settings signers and explicitly selected all eligible signers, self-approval allowed, and both transfers and issuance.

**How to apply:** Pending requests must not change balances or allocate certificate numbers. Match verified login emails to named signers, not roles. New requests capture their signer list and signature-image references; Settings changes apply to future requests, not already recorded approvals. Block new requests with no configured signers. Preserve legacy CEO/CFO records for reference without counting them as new approvals.

New transfer and issuance requests notify each captured signer with email notifications enabled separately through the connected Microsoft Outlook mailbox after the request commits. Approval remains required regardless of this preference.

**Why:** The user later selected email notifications and connected Microsoft Outlook, superseding the earlier manual-only decision.

**How to apply:** Default notifications to on for existing and newly added signers. Capture the per-signer setting with each new request; turning notifications off must not remove required approval authority or alter pending requests. Keep messages free of shareholder data, attachments, share counts, and other recipients. Treat Microsoft Graph acceptance as accepted, not delivered. Idempotent request replays must not duplicate notices. Do not backfill old pending requests; retain manual authenticated approval links.

Transfer request attachments are part of what configured signers review. They can be added by an administrator only before the first sign-off; the reviewed list stays fixed afterward. Completed transfers may receive separately audited supporting files without altering the signed request or transaction terms.

**Why:** The user requested transfer attachments alongside a distinct sign-off queue. Quietly changing the reviewed file list after approval would make the recorded sign-off ambiguous.

**How to apply:** Carry the request's files into the completed transfer, preserve both copies' meanings, and keep later supporting-file additions append-only and visible in both shareholders' history. Do not reset approvals or reinterpret appended supporting files as part of an earlier sign-off.

The Transfers navigation is company-wide history, distinct from Sign Off Requests, which shows only work still requiring the signed-in configured signer's action. The Certificates directory includes historical certificates, but a fully transferred/cancelled certificate has no remaining current holder.

**Why:** The user requested lookup across the company without opening shareholders one by one, plus a separate pending-approval queue.

**How to apply:** Preserve legacy completed transfers without approval requests, avoid duplicate completed-request/transfer rows, and distinguish original certificate holders from holders of remaining shares and successor certificates.

Transfers across different recorded family lines must show a notice, not a restriction.

**Why:** The user explicitly requested an advisory notice and said it should not restrict processing.

**How to apply:** Display the source and recipient family lines on the transfer form and review step when both are recorded and different. Do not add required acknowledgment, extra approval, or blocked submission; do not infer a family line when it is missing.

The user has not yet specified the full diluted capital base, option/warrant treatment or Preferred conversion ratios. The initial table explicitly labels a one-for-one outstanding-certificate basis rather than silently assuming a true company capitalization model.

**Why:** The screenshot names dilution columns but does not define their formulas.

**How to apply:** Confirm these business rules before extending to real option pools or convertible instruments; do not remove the calculation disclosure without replacing it with an agreed model.
