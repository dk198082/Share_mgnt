# Centralized audit search performance

## Safety and reproduction

Run from the workspace root:

```sh
pnpm --filter @workspace/api-server run test:centralized-audit
pnpm --filter @workspace/api-server run benchmark:centralized-audit --candidate-indexes
```

The test and benchmark each initialize their own PostgreSQL cluster on a private
Unix socket, with TCP disabled, and stop/remove it in `finally`. Neither accepts
an application database URL or existing database target. The loader tests run in
a child process configured exclusively for that owned cluster. The benchmark
imports only the SQL builder, not the application database module.

The default benchmark inserts **500,000 fictional rows per source** (one million
events total), using the existing primary keys and source-history indexes.
Administrative records include JSON change payloads; shareholder records include
multiple activity categories, legacy null change payloads, null/empty actor names,
10,000 fictional shareholder identities, and matching timestamps between sources.
Microsecond timestamps test cursor comparisons without JavaScript rounding.
Rare searches match one shareholder in 10,000; absent/literal searches exercise
exhaustive scans. No real history, names, or sensitive values are used.

`AUDIT_BENCH_ROWS` can select 10,000–2,000,000 rows **per source**;
`AUDIT_BENCH_REPETITIONS` selects 1–10 measured repetitions (default three).
These options change fixture size/repetitions only, never the connection target.
PostgreSQL `initdb` and `pg_ctl` must be on PATH and run as a non-root user.

The benchmark runs both the original query shape and the current application
query over the same fixture. It verifies **exact equality of all 51 returned
rows, their fields and order**, including the extra pagination row. Both timing
paths include cursor validation for older pages. SQL is run in read-only mode
after fixture setup. The optional experimental-index stage briefly enables
writes only to create an index in that same disposable cluster, then restores
read-only mode and checks result equality again.

Raw `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans and summary samples go to
`generated-artifacts/audit-benchmark/`, excluded from Git and deployment. Timings
are warmed local-client medians, not production latency guarantees or
network/authentication/API response timings. PostgreSQL version and relevant
planner settings are recorded in the summary. Cold disk, concurrent writers,
production hardware and different data distributions can change results.

## Query changes

- Resolve source-qualified cursors against the original table's **primary key**.
  Do not find one anchor by concatenating and scanning every source ID.
- Look up the anchor timestamp inside PostgreSQL; never round it through a
  JavaScript `Date`. Preserve the source-qualified tie-breaker, old unqualified
  settings cursors, and the error for an unknown cursor.
- Filter, order and limit each source to 51 before combining it, then return the
  global top 51. An event outside a source's top 51 cannot belong to the global
  top 51. This preserves category/search filtering before pagination while
  permitting bounded top-N sorting instead of sorting every wide event.
- Keep only the one-row anchor shared between cursor predicates, rather than
  materializing a full combined-history CTE for both pagination and anchor lookup.
  An inclusive timestamp bound also permits an existing timestamp index to narrow
  the candidate range; the exact tuple comparison excludes the cursor itself.
- Exclude sources that cannot contain a selected category. In particular,
  shareholder activity cannot be administrative activity; PostgreSQL does not
  infer that from the category CASE expression and otherwise scans it needlessly.
- Preserve literal, case-insensitive substring search (`%` and `_` remain literal),
  action-derived category precedence, employee snapshots, summary-only legacy
  entries, outcomes and original histories.

No schema definitions, migration files or application indexes are changed.
Neither source history is copied, backfilled, updated or deleted.

## Index candidate and remaining limits

The optional benchmark creates only:

```sql
-- EXPERIMENT ONLY, inside the disposable database.
CREATE INDEX audit_benchmark_shareholder_created
  ON shareholder_activity(created_at, id);
```

The existing shareholder-specific index begins with `shareholder_id`, so it
cannot efficiently serve an unfiltered company-wide chronological feed. A global
timestamp index is a separate operational decision. **Production index creation
requires approval**, a migration/schema-drift plan, storage/write-cost review and
a suitable release procedure. The benchmark does not perform any of those actions.

Literal substring searches and action-derived category filters may still examine
many rows, especially for absent/rare terms. The global timestamp index is not a
substring-search index. Any future search acceleration must preserve the exact
searchable fields, fallback names, literal `%`/`_`, cross-field spacing and
case-insensitive semantics; replacing substring matching with full-text search
would be a behavior change.

## Measured results

Recorded on 2026-11-11, PostgreSQL 16.10, one million synthetic events,
three measured samples per query, 4 MiB `work_mem`, 128 MiB `shared_buffers`,
up to two parallel workers per gather, JIT enabled.

| Scenario | Original, ms | Revised, existing indexes, ms | Revised + experimental index, ms |
| --- | ---: | ---: | ---: |
| First combined page | 789.49 | 101.68 | 0.77 |
| First administration page | 334.36 | 0.90 | 1.17 |
| First approvals page | 162.10 | 173.33 | 1.29 |
| Older page, halfway through history | 2339.31 | 155.64 | 1.14 |
| Older page, near oldest tenth | 1870.40 | 44.07 | 2.26 |
| Older administration page | 2099.72 | 1.84 | 1.08 |
| Older shareholders category | 2472.48 | 120.18 | 6.62 |
| Older issuance category | 1635.36 | 89.68 | 6.60 |
| Older transfers category | 2013.70 | 123.88 | 6.34 |
| Older approvals category | 2310.19 | 131.62 | 6.94 |
| Older documents category | 2101.94 | 114.65 | 6.07 |
| Common search, older page | 5990.33 | 99.71 | 1.36 |
| Common search, first page | 1055.31 | 155.12 | 1.36 |
| Rare search, older page | 2480.65 | 197.58 | 282.64 |
| Rare search, first page | 514.43 | 356.88 | 527.98 |
| Absent search | 493.85 | 364.35 | 545.45 |
| Literal `%_` search, absent | 599.35 | 401.61 | 660.95 |
| Documents search, near oldest tenth | 1903.57 | 66.93 | 10.81 |

The main comparison ran all 18 scenarios before the final source-pruning change.
The two administration scenarios were then rerun against the final query on a
fresh one-million-event fixture; those final values replace the earlier values
in the table. Reproduce that focused confirmation with
`benchmark:centralized-audit --administration-only --candidate-indexes`; it writes
to `generated-artifacts/audit-benchmark-administration/`. Source pruning removes
impossible branches only; the isolated loader tests also verify every category's
results with the final query. Running the full benchmark again uses the final
source-pruned query for every scenario.

### What the plans show

- The original first combined page writes **63,684 temporary 8 KiB blocks**
  (about 498 MiB), sorting the wide shareholder branch before merging it.
  The revised plan uses branch-local top-N sorting and writes **zero** temporary
  blocks.
- The original older-page query materializes **1,000,000 projected events** and
  then scans that CTE for its anchor and results, writing roughly 499 MiB
  (63,893–63,894 blocks). The revised plan performs a primary-key anchor lookup,
  applies the timestamp range before source limits, and does not materialize
  the entire history. All 18 revised plans write **zero** temporary blocks.
- Administration-only pages no longer scan shareholder activity to discover
  that none of its action-derived categories are administration. A shareholder
  cursor can still require a single primary-key lookup in that table.
- With the disposable global timestamp index, the combined chronological page
  uses bounded index scans/incremental sorting instead of scanning the entire
  shareholder table. Category scans can stop after finding enough matches.
- The proposed index is **not universally faster**: rare/absent/literal searches
  remain broad scans, and measured times increased for those cases. The first
  approvals page with existing indexes also showed no meaningful improvement
  (162 vs 173 ms). Do not claim a universal latency guarantee from these samples.
  Production approval should account for these tradeoffs and actual workload.

### Verification

- All 18 large-fixture comparisons matched the original query's complete
  returned rows and ordering; the experimental-index pass matched them too.
  The two final administration-only comparisons also matched before/after indexing.
- The fixture remained in read-only mode throughout query measurement, and both
  source counts remained 500,000. Disposable clusters were stopped and removed.
- `pnpm --filter @workspace/api-server run test:centralized-audit` passed:
  combined records, category/search behavior, original history availability,
  tied/sub-millisecond pagination, invalid and legacy cursors, null/empty employee
  names, protected summaries, literal wildcard characters and IDs with colons.
- `pnpm run typecheck` passed for the workspace; the API type check also passed
  after final source pruning. The restarted API served `/api/healthz` successfully.

No production data was loaded or queried for this assessment. No application
database indexes, schemas, source rows or historical records were changed.
