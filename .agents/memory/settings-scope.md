---
name: Administrative settings scope
description: User-confirmed boundaries for access management, share prices and uploaded signatory signatures.
---
Settings belongs at the bottom of the left navigation, above the signed-in user. Share prices and Sign-offs remain Settings functions; the current pilot access policy is in replit.md.

**Why:** The user explicitly requested these three administrative functions and that navigation placement.

**How to apply:** Preserve the navigation placement. Do not restore the superseded Administrator-only gate or separate app invitations during the pilot.

The Sign-offs tab defines the named signers for both transfers and certificate issuances; its fields are name, email and an uploaded signature image.

**Why:** The user superseded the earlier configuration-only scope, explicitly requested only Administrator, and selected all eligible signers, self-approval allowed, and both transfers and issuance.

**How to apply:** Use the named verified email identities for approvals, never CEO/CFO roles. Adding a signer does not grant private-publishing access, and uploading a signature image is not itself an approval. Retain private image snapshots with authenticated recorded decisions. Do not introduce signature drawing.

New transfer and issuance requests send one private notification per captured, email-enabled signer through the connected Microsoft Outlook mailbox. Email content is limited to the request type and authenticated approval link.

**Why:** The user explicitly selected email notifications and connected Microsoft Outlook for application delivery.

**How to apply:** Queue notifications in the request transaction and send only after commit. Never expose shareholder details or other signers' addresses. Outlook acceptance is not proof of delivery. Do not send retroactively for old requests or automatically retry uncertain outcomes; preserve the in-app queue and copyable link as fallback.

Approval confirmation must appear in a compact centered popup rather than being appended below the request.

**Why:** The user reported that approvers did not realize they needed to scroll down to confirm.

**How to apply:** Keep the explicit confirmation step and final-execution warning visible in the popup; do not turn the initial Approve button into immediate approval.

After final approval or rejection, notify the original requester privately with only the request type, outcome and authenticated app link.

**Why:** The user requested an email that closes the loop for employees who submitted transfers or issuances.

**How to apply:** Capture a verified requester address at submission, keep it out of API responses, and make outcome delivery idempotent and independent of the committed decision.

Common and Preferred share prices are always in US Dollars. Backdating is allowed with a required reason. Dated lookups are historical reference only; the current Settings price now defaults new transfer forms for the certificate's share class. Do not rewrite existing transfer prices, change approval enforcement, or change dilution calculations.

**Why:** The user confirmed USD, backdating with a required reason, and historical reference only, then explicitly requested that Price per Share on new transfers pull from Settings automatically.

**How to apply:** Preserve exact decimal strings and initially unset values. Never infer effective dates for legacy settings. Keep immutable prior entries when correcting a dated reference price.

Share-price navigation belongs in Settings only, not as a separate left-pane option. Certificates belongs between Shareholders and Transfers. The transfer form's first field must show the current certificate holder.

**Why:** The user explicitly requested this placement and the visible source holder.

**How to apply:** Preserve this order in desktop and mobile navigation. Seed new transfer prices from the same current values shown in Settings (including an undated legacy value), without changing a draft's edited/reviewed price on background refresh.

Effective dates are calendar-only days, with UTC used consistently for "today" and the backdating boundary. A same-day correction is a new entry; the last recorded entry for that effective day applies.

**Why:** A deterministic calendar boundary avoids server/browser timezone disagreements, and append-only corrections preserve what employees previously saw without deleting history.

**How to apply:** Keep the UTC convention visible in the UI. Changing the business calendar or correction precedence requires an explicit policy decision, not a local timezone conversion.
