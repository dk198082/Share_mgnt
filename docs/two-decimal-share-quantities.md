# Two-decimal share quantities

Common and Preferred share quantities support up to two decimal places, including `0.01` shares. Whole-share values remain valid. Prices retain their separate existing precision; certificate IDs and class sequence counters remain integers.

The issuance and transfer forms accept decimal quantities and reject excess precision rather than silently rounding. The same checks run in the API and transaction services. All share arithmetic uses integer hundredths, including partial/full transfers, batch allocation totals, shareholder/company balances, and report running balances. JSON responses remain numbers; database quantity columns use `numeric(15,2)` with the existing one-trillion-share per-operation limit.

Approved request snapshots, history, certificate directories and PDFs retain the fractional quantity. Exact transfer consideration combines hundredth-share units with the existing six-decimal price precision; reports can retain eight decimal places for the product.

## Preview and testing

Preview schema changes use the ordinary development-only Drizzle push. No shareholder reset, data import or production migration is part of this change.

```text
pnpm --filter @workspace/db run test:share-quantities
```

This runner creates and owns a disposable PostgreSQL cluster with a private Unix socket. It cannot be pointed at Preview or Azure. It builds the previous bigint schema, verifies the actual widening SQL preserves an existing maximum-sized integer position, checks schema compatibility, and exercises synthetic issuance, approvals, transfers, batches, retries, reports, PDFs and input validation. Existing certificate/approval/report/PDF suites run in the same isolated cluster. No real emails or storage uploads are sent.

## Azure release requirement

The reviewed migration is `lib/db/migrations/20261113170000_two_decimal_share_quantities.sql`. It widens only three quantity columns: `certificates.quantity`, `certificates.transferred_quantity` and `share_transfers.quantity`. Existing values and certificate numbers are preserved. The table alterations take database locks, so schedule the authorized migration during a suitable release window.

**The migration has not been applied to Azure by this work.** Apply it only through the authorized Azure migration process documented in `azure-schema-migrations.md`, confirm the post-migration schema check, and publish the compatible app together. Publishing by itself does not update Azure's schema. Do not enable fractional production writes against the old bigint columns.

The legacy importer is still at its separate mapping-review gate; enabling fractional runtime quantities does not authorize a reset or production import.
