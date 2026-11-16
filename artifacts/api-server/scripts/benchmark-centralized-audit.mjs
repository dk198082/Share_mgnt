// No application DB imports or configurable connection target. Only the owned
// cluster's client executes SQL. Run with: node --import tsx scripts/benchmark-centralized-audit.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { startDisposablePostgres } from "../../../lib/db/scripts/test-support/disposable-postgres.mjs";
import { auditEvents, auditAnchorQuery, auditPageQuery } from "../src/lib/centralized-audit-query.ts";

const dialect = new PgDialect();
const onlyAdministration = process.argv.includes("--administration-only");
const output = new URL(`../../../generated-artifacts/audit-benchmark${onlyAdministration ? "-administration" : ""}/`, import.meta.url);
const rows = Number(process.env.AUDIT_BENCH_ROWS ?? 500000);
const repetitions = Number(process.env.AUDIT_BENCH_REPETITIONS ?? 3);
assert.ok(Number.isInteger(rows) && rows >= 10000 && rows <= 2000000);
assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 10);

// Frozen pre-optimization query shape, including the multiply referenced CTE.
function baseline({ cursor, category, search: input }) {
  const search = input?.trim() ?? "";
  return sql`WITH events AS (${auditEvents})
    SELECT * FROM events
    WHERE ${category && category !== "all" ? sql`category = ${category}` : sql`true`}
      AND ${search ? sql`strpos(lower(concat_ws(' ', action, actor_name, shareholder_name, target_id)), lower(${search})) > 0` : sql`true`}
      AND ${cursor ? sql`(created_at, key) < (SELECT created_at, key FROM events WHERE key = ${cursor})` : sql`true`}
    ORDER BY created_at DESC, key DESC LIMIT 51`;
}
const scenarios = [
  ["first", {}],
  ["first-administration", { category: "administration" }],
  ["first-approvals", { category: "approvals" }],
  ["older-half", { cursor: `shareholder:${Math.floor(rows / 2)}` }],
  ["older-deep", { cursor: `administration:${Math.floor(rows / 10)}` }],
  ...["administration", "shareholders", "issuance", "transfers", "approvals", "documents"].map(category =>
    [`category-${category}`, { category, cursor: `shareholder:${Math.floor(rows / 2)}` }]),
  ["search-common", { search: "Fictional", cursor: `shareholder:${Math.floor(rows / 2)}` }],
  ["search-common-first", { search: "Fictional" }],
  ["search-rare", { search: "Needle-7021", cursor: `shareholder:${Math.floor(rows / 2)}` }],
  ["search-rare-first", { search: "Needle-7021" }],
  ["search-absent", { search: "not present anywhere" }],
  ["search-literal", { search: "%_" }],
  ["search-category", { category: "documents", search: "Fictional", cursor: `administration:${Math.floor(rows / 10)}` }],
];

const postgres = await startDisposablePostgres();
try {
  const client = await postgres.connect("migration_test_audit_benchmark");
  await client.query("SET statement_timeout = '60s'");
  // Large fixture construction can exceed the helper's short per-query timeout.
  // Only this setup statement gets a larger client budget; measured reads keep
  // the helper's default timeout and the server still enforces statement_timeout.
  await client.query({ query_timeout: 60000, text: `CREATE TABLE settings_audit (
    id text PRIMARY KEY, actor_id text NOT NULL, actor_name text NOT NULL, action text NOT NULL,
    target_id text NOT NULL, outcome text NOT NULL, changes jsonb NOT NULL, detail text,
    created_at timestamptz NOT NULL, completed_at timestamptz);
    CREATE INDEX settings_audit_created_idx ON settings_audit(created_at, id);
    CREATE TABLE shareholder_activity (
    id text PRIMARY KEY, shareholder_id text NOT NULL, name text NOT NULL, action text NOT NULL,
    actor text NOT NULL, actor_name text, changes jsonb, created_at timestamptz NOT NULL);
    CREATE INDEX shareholder_activity_history_index ON shareholder_activity(shareholder_id, created_at, id);
    INSERT INTO settings_audit
      SELECT n::text, 'fictional-employee-' || n % 100, 'Fictional Employee ' || n % 100,
        'Share prices changed', 'prices-' || n % 100, 'succeeded',
        jsonb_build_array(jsonb_build_object('field','Fictional notes','before',repeat(md5(n::text),8),'after','changed','protected',false)),
        NULL, '2024-01-01'::timestamptz + (n/4) * interval '1 second' + (n%4)*interval '1 microsecond', NULL
      FROM generate_series(1, ${rows}) n;
    INSERT INTO shareholder_activity
      SELECT n::text, 'fictional-holder-' || n % 10000,
        CASE WHEN n%10000=7021 THEN 'Needle-7021' ELSE 'Fictional Shareholder ' || n%10000 END,
        (ARRAY['Record updated','Certificate issuance requested','10 shares transferred',
          'Signer approved transfer','Supporting files added','Legacy record imported'])[1+n%6],
        'fictional-employee-' || n%100,
        CASE WHEN n%20=0 THEN NULL WHEN n%17=0 THEN '' ELSE 'Fictional Employee ' || n%100 END,
        CASE WHEN n%6=5 THEN NULL ELSE jsonb_build_array(jsonb_build_object('field','Fictional notes',
          'before',repeat(md5(n::text),8),'after','changed','protected',false)) END,
        '2024-01-01'::timestamptz + (n/4)*interval '1 second' + (n%4)*interval '1 microsecond'
      FROM generate_series(1, ${rows}) n;
    ANALYZE settings_audit; ANALYZE shareholder_activity;` });
  await mkdir(output, { recursive: true });
  await client.query("SET default_transaction_read_only = on");
  const report = {
    postgres: (await client.query("SELECT version()")).rows[0].version,
    rowsPerSource: rows, repetitions,
    settings: (await client.query("SELECT name,setting FROM pg_settings WHERE name IN ('work_mem','shared_buffers','max_parallel_workers_per_gather','jit')")).rows,
    results: [],
  };
  async function execute(query, explain = false) {
    const compiled = dialect.sqlToQuery(query);
    return client.query((explain ? "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " : "") + compiled.sql, compiled.params);
  }
  // Baseline and candidate both include the API's cursor existence check.
  async function measure(query, options, old = false) {
    const anchor = options.cursor && (old
      ? sql`WITH events AS (${auditEvents}) SELECT key FROM events WHERE key = ${options.cursor}`
      : auditAnchorQuery(options.cursor));
    if (anchor) await execute(anchor);
    await execute(query); // warm-up; deliberately not a cold-disk benchmark
    const times = [];
    let result;
    for (let i = 0; i < repetitions; i++) {
      const start = performance.now();
      if (anchor) await execute(anchor);
      result = await execute(query);
      times.push(performance.now() - start);
    }
    times.sort((a,b) => a-b);
    return { medianMs: +times[Math.floor(times.length / 2)].toFixed(2), rows: result.rows, times };
  }
  const expectedRows = new Map();
  const selectedScenarios = onlyAdministration
    ? scenarios.filter(([, options]) => options.category === "administration") : scenarios;
  for (const [name, options] of selectedScenarios) {
    const oldQuery = baseline(options);
    const newQuery = auditPageQuery({ cursor: null, ...options });
    const oldResult = await measure(oldQuery, options, true);
    const newResult = await measure(newQuery, options);
    assert.deepEqual(newResult.rows, oldResult.rows, `${name}: exact rows and order`);
    expectedRows.set(name, oldResult.rows);
    const oldPlan = (await execute(oldQuery, true)).rows[0]["QUERY PLAN"][0];
    const newPlan = (await execute(newQuery, true)).rows[0]["QUERY PLAN"][0];
    assert.ok(!JSON.stringify(newPlan).includes('"CTE events"'), `${name}: no full history materialization`);
    await writeFile(new URL(`${name}.json`, output), JSON.stringify({ options, baseline: oldPlan, candidate: newPlan }, null, 2));
    const summary = { name, baselineMs: oldResult.medianMs, candidateMs: newResult.medianMs,
      returned: newResult.rows.length, baselineTempWritten: oldPlan.Plan["Temp Written Blocks"],
      candidateTempWritten: newPlan.Plan["Temp Written Blocks"],
      baselineSamplesMs: oldResult.times.map(n => +n.toFixed(2)),
      candidateSamplesMs: newResult.times.map(n => +n.toFixed(2)) };
    report.results.push(summary);
    console.log(JSON.stringify(summary));
  }
  // Experimental indexes are never installed in an application database, schema
  // definition or migration. This flag measures the value of requesting approval.
  if (process.argv.includes("--candidate-indexes")) {
    await client.query("SET default_transaction_read_only = off");
    await client.query(`CREATE INDEX audit_benchmark_shareholder_created
      ON shareholder_activity(created_at, id);
      ANALYZE shareholder_activity`);
    await client.query("SET default_transaction_read_only = on");
    report.candidateIndex = "shareholder_activity(created_at, id)";
    report.indexedResults = [];
    for (const [name, options] of selectedScenarios) {
      const query = auditPageQuery({ cursor: null, ...options });
      const measured = await measure(query, options);
      assert.deepEqual(measured.rows, expectedRows.get(name), `${name}: indexed results unchanged`);
      const plan = (await execute(query, true)).rows[0]["QUERY PLAN"][0];
      await writeFile(new URL(`${name}-indexed.json`, output), JSON.stringify(plan, null, 2));
      const summary = { name, medianMs: measured.medianMs, tempWritten: plan.Plan["Temp Written Blocks"],
        samplesMs: measured.times.map(n => +n.toFixed(2)) };
      report.indexedResults.push(summary);
      console.log(JSON.stringify({ indexed: true, ...summary }));
    }
  }
  assert.deepEqual((await client.query(`SELECT
    (SELECT count(*)::int FROM settings_audit) AS settings,
    (SELECT count(*)::int FROM shareholder_activity) AS activity`)).rows[0], { settings: rows, activity: rows });
  await writeFile(new URL("summary.json", output), JSON.stringify(report, null, 2));
} finally {
  await postgres.close();
}
