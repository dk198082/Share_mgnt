---
name: Workflow lifecycle after merges
description: Managed workflow failures can disagree with actual listener liveness after a task merge.
---

A failed managed workflow after a task merge does not necessarily mean the application stopped serving. An older server process can still own the configured port while the replacement fails with EADDRINUSE.

**Why:** This occurred on consecutive task merges for both the API and web preview. The failures were process-lifecycle conflicts, not application or port-configuration defects.

**How to apply:** Compare managed workflow status with the actual listening process before changing code or ports. Restore ownership to the existing configured workflow rather than introducing duplicate servers.
