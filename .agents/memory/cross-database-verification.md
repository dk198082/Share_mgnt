---
name: Cross-database data verification
description: Avoid false checksum mismatches when comparing Replit and Azure PostgreSQL rows.
---

Verify copied data with order-independent, full-row multiset equality rather
than hashes of aggregates sorted using each server's default text collation.

**Why:** Replit and Azure produced different sort orders for identical rows.
Aggregate hashes differed even though every field was equal, causing safe but
unnecessary transaction rollbacks.

**How to apply:** Compare both directions with JSONB `EXCEPT ALL`, preserving
duplicates, or explicitly use the same deterministic collation on both sides.
Keep the original PostgreSQL JSON text when transporting values; do not
parse and reserialize numeric data through JavaScript before insertion.
