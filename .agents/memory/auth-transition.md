---
name: Pilot identity transition
description: Why fresh Replit identities coexist with historical Clerk actor IDs.
---
The user approved replacing the pilot's separate Clerk onboarding with existing Replit accounts while retaining individual history and named signer matching. This project started directly with Clerk; there is no prior Replit-to-Clerk migration to roll back.

**Why:** Pilot testers were blocked by separate workspace and app invitations. The user explicitly rejected treating actions as a shared anonymous pilot identity and confirmed individual tracking must remain.

**How to apply:** Treat Replit identity as a fresh provider connection, not a conversion of Clerk accounts. Preserve historical provider IDs, event-time names, signer snapshots, and recorded decisions. Never merge historical actors based on a display name or replace old sign-offs with new fabricated approvals. The future Azure deployment will use Microsoft Entra ID, not a shared pilot identity.

The user has explicitly authorized direct, tenant-specific Microsoft Entra
sign-in using only the configured `CLIENT_ID`, `CLIENT_SECRET`, and `TENANT_ID`.
Do not add the Admin Console access check, Microsoft Graph, or Entra role
mapping. Any authenticated account in the configured tenant receives equal app
access, while pending approvals still require a matching Settings signer.

**Why:** The user overrode the earlier deferred Entra plan and rejected the
separate authorization service from the supplied flow. They authorized identity
verification through Entra without app-level role checks.

**How to apply:** Validate the configured tenant and immutable Entra object ID.
Use the signed tenant sign-in address for signer matching, preserve historical
actor records, and do not enable shareholder self-service before phase 2.
Replit private publishing may still add a separate entry gate.

Current Entra identity details live in server-side sessions rather than being
upserted into the legacy `users` table. That table's unique email key must not
cause different provider IDs to be silently merged.

**Why:** Existing Replit/Clerk rows can share the same email as the new Entra
object ID, and email equality is not proof that two historical actor IDs are
the same person.

**How to apply:** If a durable cross-provider identity directory is added later,
use provider-qualified immutable IDs and an explicit reviewed linking flow.

Background session checks must preserve the mounted page and its unsaved forms while an authenticated session is being revalidated.

**Why:** Native file pickers return window focus; treating that check like initial sign-in discarded the sign-off dialog and its selected signature before upload.

**How to apply:** Keep focus-based session revalidation and deny access when it returns no user, but reserve the blocking loading screen for initial sign-in or retrying an unauthenticated check.
