import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  applyPendingMigrations,
  getMigrationStatus,
  loadMigrations,
  parseMigration,
} from "./azure-migration-lib.mjs";
import { startDisposablePostgres } from "./test-support/disposable-postgres.mjs";

const fixtures = fileURLToPath(new URL("./fixtures/azure-migrations/", import.meta.url));
const failingFixtures = fileURLToPath(new URL("./fixtures/azure-migrations-failing/", import.meta.url));

async function seed(client) {
  await client.query(`
    CREATE TABLE fictional_shareholders (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      display_name text NOT NULL,
      shares integer NOT NULL CHECK (shares >= 0),
      obsolete_test_flag boolean
    );
    INSERT INTO fictional_shareholders (display_name, shares)
      VALUES ('Fictional Shareholder Alpha', 10), ('Fictional Shareholder Beta', 20);
  `);
}

async function ledger(client) {
  return (await client.query(
    'SELECT version, checksum FROM "__app_schema_migrations" ORDER BY version',
  )).rows;
}

async function waitForAdvisoryBlock(observer, blocked, blocker) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows: [activity] } = await observer.query(`
      SELECT wait_event_type, wait_event, $2::int = ANY(pg_blocking_pids(pid)) AS blocked
      FROM pg_stat_activity WHERE pid = $1
    `, [blocked.processID, blocker.processID]);
    if (activity?.blocked && activity.wait_event_type === "Lock" && activity.wait_event === "advisory") {
      return;
    }
    await setTimeout(20);
  }
  assert.fail(`PostgreSQL client ${blocked.processID} did not wait on advisory lock held by ${blocker.processID}`);
}

async function concurrentClients(postgres, schema) {
  const first = await postgres.connect(schema);
  // The helper owns every connection and creates a fresh schema for each.
  // Point the independent follower at the first runner's queue, not at any external target.
  const second = await postgres.connect(`${schema}_follower`);
  await second.query(`SET search_path TO "${schema}"`);
  const observer = await postgres.connect(`${schema}_observer`);
  await observer.query(`SET search_path TO "${schema}"`);
  for (const client of [first, second]) {
    // Bound lock waits even if a regression prevents the runner from unlocking.
    await client.query("SET statement_timeout = '8s'");
  }
  assert.notEqual(first.processID, second.processID);
  return { first, second, observer };
}

function observeRun(promise) {
  // Attach rejection handlers immediately while the other connection is being inspected.
  return promise.then((value) => ({ value }), (error) => ({ error }));
}

// SET ROLE is confined to a client on the harness-owned cluster. Its session
// administrator only arranges fixtures; migration calls run as the restricted role.
async function asRestrictedRole(client, role, operation) {
  await client.query(`SET ROLE "${role}"`);
  try {
    const { rows: [identity] } = await client.query(`
      SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole,
        rolinherit, rolcanlogin, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `);
    assert.deepEqual(identity, {
      name: role, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
      rolinherit: false, rolcanlogin: false, rolreplication: false, rolbypassrls: false,
    });
    await operation();
  } finally {
    await client.query("RESET ROLE");
  }
}

async function restrictedFixture(postgres, suffix, { schemaGrants = "USAGE, CREATE", ownsTable = true } = {}) {
  const schema = `migration_test_${suffix}`;
  const role = `${schema}_runner`;
  const client = await postgres.connect(schema);
  await seed(client);
  await client.query(`
    CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOINHERIT NOREPLICATION NOBYPASSRLS;
    REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC;
    GRANT ${schemaGrants} ON SCHEMA "${schema}" TO "${role}";
  `);
  if (ownsTable) {
    await client.query(`ALTER TABLE fictional_shareholders OWNER TO "${role}"`);
  }
  return { client, schema, role };
}

const permissionProbe = parseMigration("20260101000002_permission_probe.sql", `
-- Reviewed: fictional restricted migration fixture
-- Explicitly approved: exercise rollback of fictional DDL and data on permission failure
CREATE TABLE fictional_permission_probe (id integer);
UPDATE fictional_shareholders SET shares = shares + 1;
ALTER TABLE fictional_shareholders ADD COLUMN permission_probe boolean;
`);

async function assertPermissionRollback(client, schema, expectedLedger) {
  assert.equal((await client.query(
    "SELECT to_regclass('fictional_permission_probe') AS relation",
  )).rows[0].relation, null);
  assert.equal((await client.query(`
    SELECT count(*)::int AS count FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = 'fictional_shareholders'
      AND column_name IN ('reviewed', 'permission_probe')
  `, [schema])).rows[0].count, expectedLedger?.length ? 1 : 0);
  assert.deepEqual((await client.query(
    "SELECT display_name, shares FROM fictional_shareholders ORDER BY id",
  )).rows, [
    { display_name: "Fictional Shareholder Alpha", shares: 10 },
    { display_name: "Fictional Shareholder Beta", shares: 20 },
  ]);
  const relation = (await client.query(
    "SELECT to_regclass($1) AS relation", [`"${schema}"."__app_schema_migrations"`],
  )).rows[0].relation;
  if (expectedLedger === null) {
    assert.equal(relation, null);
  } else {
    assert.ok(relation);
    assert.deepEqual(await ledger(client), expectedLedger);
  }
}

function permissionDenied(error) {
  assert.equal((error.cause ?? error).code, "42501");
  return true;
}

test("reviewed migrations against a private disposable PostgreSQL cluster", { timeout: 120_000 }, async (t) => {
  const postgres = await startDisposablePostgres();
  t.after(() => postgres.close());
  const migrations = await loadMigrations(fixtures);

  await t.test("target is a private Unix socket, never an application database", async () => {
    await assert.rejects(postgres.connect("public"), /migration_test_/);
    await assert.rejects(postgres.connect("Shareholdermanagement"), /migration_test_/);
    const client = await postgres.connect("migration_test_target");
    assert.equal(client.connectionParameters.host, postgres.directory);
    assert.equal(client.connectionParameters.database, "fictional_migration_test");
    assert.equal(client.connectionParameters.user, "migration_test_admin");
    assert.equal(client.connectionParameters.ssl, false);
    const { rows: [target] } = await client.query(`
      SELECT current_database() AS database, current_schema() AS schema,
        inet_server_addr() AS address, current_setting('listen_addresses') AS listeners
    `);
    assert.deepEqual(target, {
      database: "fictional_migration_test",
      schema: "migration_test_target",
      address: null,
      listeners: "",
    });
  });

  await t.test("read-only status, additive DDL, approved change, real ledger and repeat apply", async () => {
    const client = await postgres.connect("migration_test_apply");
    await seed(client);
    await client.query("BEGIN READ ONLY");
    const before = await getMigrationStatus(client, migrations, "migration_test_apply");
    await client.query("COMMIT");
    assert.deepEqual(before.applied, []);
    assert.equal(before.pending.length, 2);
    assert.equal((await client.query(
      "SELECT to_regclass('migration_test_apply.__app_schema_migrations') AS ledger",
    )).rows[0].ledger, null);

    assert.deepEqual(
      await applyPendingMigrations(client, migrations, "migration_test_apply"),
      migrations.map(({ version }) => version),
    );
    assert.deepEqual(await ledger(client), migrations.map(({ version, sql }) => ({
      version, checksum: createHash("sha256").update(sql).digest("hex"),
    })));
    assert.deepEqual((await client.query(
      "SELECT display_name, shares, reviewed FROM fictional_shareholders ORDER BY id",
    )).rows, [
      { display_name: "Fictional Shareholder Alpha", shares: 10, reviewed: true },
      { display_name: "Fictional Shareholder Beta", shares: 20, reviewed: false },
    ]);
    const columns = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'fictional_shareholders'",
      ["migration_test_apply"],
    );
    assert.equal(columns.rows.some(({ column_name }) => column_name === "obsolete_test_flag"), false);
    assert.ok((await client.query(
      "SELECT to_regclass('fictional_shareholders_reviewed_idx') AS index",
    )).rows[0].index);
    assert.deepEqual(await applyPendingMigrations(client, migrations, "migration_test_apply"), []);
    assert.deepEqual(await getMigrationStatus(client, migrations, "migration_test_apply"), {
      applied: migrations.map(({ version }) => version), pending: [],
    });
  });

  await t.test("changed or missing applied files block pending SQL without modifying the ledger", async () => {
    const client = await postgres.connect("migration_test_checksums");
    await seed(client);
    await applyPendingMigrations(client, migrations, "migration_test_checksums");
    const originalLedger = await ledger(client);
    const pending = parseMigration("20260101000002_pending_probe.sql",
      "-- Reviewed: fictional checksum fixture\nCREATE TABLE fictional_pending_probe (id integer);");
    const changed = parseMigration(migrations[0].filename, `${migrations[0].sql}\n-- changed bytes\n`);
    for (const operation of [getMigrationStatus, applyPendingMigrations]) {
      await assert.rejects(operation(client, [changed, migrations[1], pending], "migration_test_checksums"),
        /Applied migration 20260101000000 has changed/);
      await assert.rejects(operation(client, [pending], "migration_test_checksums"),
        /has no matching file/);
    }
    assert.equal((await client.query(
      "SELECT to_regclass('fictional_pending_probe') AS relation",
    )).rows[0].relation, null);
    assert.deepEqual(await ledger(client), originalLedger);
  });

  await t.test("overlapping runners wait, reread the ledger, and apply each version exactly once", async () => {
    const schema = "migration_test_concurrent";
    const { first, second, observer } = await concurrentClients(postgres, schema);
    await first.query("CREATE TABLE fictional_apply_effects (version text NOT NULL)");
    const queue = [
      parseMigration("20260101000000_concurrent_first.sql", `
        -- Reviewed: fictional concurrent migration fixture
        SELECT pg_advisory_xact_lock(29001, 1);
        INSERT INTO fictional_apply_effects VALUES ('20260101000000');
      `),
      parseMigration("20260101000001_concurrent_second.sql", `
        -- Reviewed: fictional concurrent migration fixture
        INSERT INTO fictional_apply_effects VALUES ('20260101000001');
      `),
    ];
    const versions = queue.map(({ version }) => version);
    for (const client of [first, second]) {
      assert.deepEqual((await getMigrationStatus(client, queue, schema)).pending, queue);
    }
    // A separate test-only lock gates SQL after the first runner owns the migration lock.
    await observer.query("SELECT pg_advisory_lock(29001, 1)");
    const runs = [];
    try {
      runs.push(observeRun(applyPendingMigrations(first, queue, schema)));
      await waitForAdvisoryBlock(observer, first, observer);
      runs.push(observeRun(applyPendingMigrations(second, queue, schema)));
      await waitForAdvisoryBlock(observer, second, first);
      // Inspect through the observer: the follower's connection is busy waiting.
      assert.deepEqual(await ledger(observer), []);
      assert.deepEqual((await observer.query("SELECT * FROM fictional_apply_effects")).rows, []);

      await observer.query("SELECT pg_advisory_unlock(29001, 1)");
      const [leader, follower] = await Promise.all(runs);
      assert.deepEqual(leader, { value: versions });
      // This runner saw the whole queue pending before waiting. Only a reread
      // after acquiring the lock can discover that there is now nothing to do.
      assert.deepEqual(follower, { value: [] });
      assert.deepEqual(await ledger(second), queue.map(({ version, checksum }) => ({ version, checksum })));
      // No uniqueness constraint hides duplicate side effects.
      assert.deepEqual((await second.query(`
        SELECT version, count(*)::int AS count FROM fictional_apply_effects
        GROUP BY version ORDER BY version
      `)).rows, versions.map((version) => ({ version, count: 1 })));
      assert.deepEqual(await getMigrationStatus(second, queue, schema), { applied: versions, pending: [] });
      assert.deepEqual((await observer.query(`
        SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND pid = ANY($1::int[])
      `, [[first.processID, second.processID]])).rows, []);
    } finally {
      await observer.query("SELECT pg_advisory_unlock_all()");
      await Promise.allSettled(runs);
    }
  });

  await t.test("SQL failure releases the session lock so a waiting runner can recover", async () => {
    const schema = "migration_test_concurrent_failure";
    const { first, second, observer } = await concurrentClients(postgres, schema);
    await seed(first);
    const [failure] = await loadMigrations(failingFixtures);
    const gatedFailure = parseMigration(failure.filename,
      `-- Reviewed: fictional gated failure fixture\nSELECT pg_advisory_xact_lock(29001, 2);\n${failure.sql}`);
    const corrected = parseMigration(failure.filename, `
      -- Reviewed: fictional concurrent retry fixture
      CREATE TABLE fictional_retry_probe (id integer);
      INSERT INTO fictional_retry_probe VALUES (1);
    `);
    await observer.query("SELECT pg_advisory_lock(29001, 2)");
    const runs = [];
    try {
      runs.push(observeRun(applyPendingMigrations(first, [...migrations, gatedFailure], schema)));
      await waitForAdvisoryBlock(observer, first, observer);
      assert.deepEqual(await ledger(second), migrations.map(({ version, checksum }) => ({ version, checksum })));
      runs.push(observeRun(applyPendingMigrations(second, [...migrations, corrected], schema)));
      await waitForAdvisoryBlock(observer, second, first);

      await observer.query("SELECT pg_advisory_unlock(29001, 2)");
      const [failed, recovered] = await Promise.all(runs);
      assert.ok(failed.error);
      assert.match(failed.error.message, /its transaction was rolled back/);
      assert.equal(failed.error.cause.code, "23514");
      assert.deepEqual(recovered, { value: [failure.version] });
      assert.deepEqual(await ledger(second),
        [...migrations, corrected].map(({ version, checksum }) => ({ version, checksum })));
      assert.equal((await second.query(
        "SELECT to_regclass('fictional_rollback_probe') AS relation",
      )).rows[0].relation, null);
      assert.deepEqual((await second.query("SELECT * FROM fictional_retry_probe")).rows, [{ id: 1 }]);
      // Keep the failed session open: disconnecting it would conceal a missing unlock.
      assert.deepEqual((await first.query("SELECT 1 AS usable")).rows, [{ usable: 1 }]);
      assert.deepEqual((await observer.query(`
        SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND pid = ANY($1::int[])
      `, [[first.processID, second.processID]])).rows, []);
    } finally {
      await observer.query("SELECT pg_advisory_unlock_all()");
      await Promise.allSettled(runs);
    }
  });

  await t.test("SQL failure rolls back DDL, data, and ledger while preserving earlier commits", async () => {
    const client = await postgres.connect("migration_test_rollback");
    await seed(client);
    const [failure] = await loadMigrations(failingFixtures);
    await assert.rejects(
      applyPendingMigrations(client, [...migrations, failure], "migration_test_rollback"),
      (error) => {
        assert.match(error.message, /its transaction was rolled back/);
        assert.equal(error.cause.code, "23514"); // Real PostgreSQL CHECK violation.
        return true;
      },
    );
    assert.deepEqual((await ledger(client)).map(({ version }) => version),
      migrations.map(({ version }) => version));
    assert.equal((await client.query("SELECT to_regclass('fictional_rollback_probe') AS relation")).rows[0].relation, null);
    assert.equal((await client.query(
      "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema = $1 AND column_name = 'rollback_probe'",
      ["migration_test_rollback"],
    )).rows[0].count, 0);
    assert.deepEqual((await client.query(
      "SELECT display_name, reviewed FROM fictional_shareholders ORDER BY id",
    )).rows, [
      { display_name: "Fictional Shareholder Alpha", reviewed: true },
      { display_name: "Fictional Shareholder Beta", reviewed: false },
    ]);
    assert.deepEqual((await getMigrationStatus(client, [...migrations, failure], "migration_test_rollback"))
      .pending.map(({ version }) => version), [failure.version]);
    // A failed, unrecorded migration can be corrected and retried.
    const corrected = parseMigration(failure.filename,
      "-- Reviewed: fictional retry fixture\nCREATE TABLE fictional_retry_probe (id integer);");
    assert.deepEqual(await applyPendingMigrations(client, [...migrations, corrected], "migration_test_rollback"),
      [failure.version]);
  });

  await t.test("ledger write failure also rolls back successful migration SQL", async () => {
    const client = await postgres.connect("migration_test_ledger_failure");
    await seed(client);
    await applyPendingMigrations(client, migrations, "migration_test_ledger_failure");
    const originalLedger = await ledger(client);
    await client.query(`ALTER TABLE "__app_schema_migrations"
      ADD CONSTRAINT fictional_reject_next_version CHECK (version <> '20260101000002')`);
    const pending = parseMigration("20260101000002_ledger_failure.sql",
      "-- Reviewed: fictional ledger fixture\nCREATE TABLE fictional_ledger_probe (id integer);");
    await assert.rejects(
      applyPendingMigrations(client, [...migrations, pending], "migration_test_ledger_failure"),
      (error) => error.cause?.code === "23514",
    );
    assert.equal((await client.query("SELECT to_regclass('fictional_ledger_probe') AS relation")).rows[0].relation, null);
    assert.deepEqual(await ledger(client), originalLedger);
  });

  await t.test("non-superuser with schema grants and table ownership creates and extends the ledger", async () => {
    const { client, schema, role } = await restrictedFixture(postgres, "restricted_success");
    await asRestrictedRole(client, role, async () => {
      await client.query("BEGIN READ ONLY");
      assert.deepEqual(await getMigrationStatus(client, migrations, schema), {
        applied: [], pending: migrations,
      });
      await client.query("COMMIT");
      assert.deepEqual(await applyPendingMigrations(client, [migrations[0]], schema),
        [migrations[0].version]);
      assert.deepEqual(await applyPendingMigrations(client, migrations, schema),
        [migrations[1].version]);
      assert.deepEqual(await ledger(client), migrations.map(({ version, checksum }) => ({ version, checksum })));
      assert.deepEqual(await applyPendingMigrations(client, migrations, schema), []);
      await client.query("BEGIN READ ONLY");
      assert.deepEqual(await getMigrationStatus(client, migrations, schema), {
        applied: migrations.map(({ version }) => version), pending: [],
      });
      await client.query("COMMIT");
    });
    assert.equal((await client.query(`
      SELECT pg_get_userbyid(relowner) AS owner FROM pg_class
      WHERE oid = '__app_schema_migrations'::regclass
    `)).rows[0].owner, role);
    assert.equal((await client.query(
      "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = $1", [schema],
    )).rows[0].owner, "migration_test_admin");
    assert.deepEqual((await client.query(
      "SELECT shares, reviewed FROM fictional_shareholders ORDER BY id",
    )).rows, [{ shares: 10, reviewed: true }, { shares: 20, reviewed: false }]);
    assert.ok((await client.query(
      "SELECT to_regclass('fictional_shareholders_reviewed_idx') AS relation",
    )).rows[0].relation);
    assert.equal((await client.query(`
      SELECT count(*)::int AS count FROM information_schema.columns
      WHERE table_schema = $1 AND column_name = 'obsolete_test_flag'
    `, [schema])).rows[0].count, 0);
  });

  for (const [suffix, schemaGrants] of [
    ["no_schema_usage", "CREATE"], ["no_schema_create", "USAGE"],
  ]) {
    await t.test(`${suffix} fails before any migration or ledger changes`, async () => {
      const { client, schema, role } = await restrictedFixture(postgres, suffix, { schemaGrants });
      await asRestrictedRole(client, role, async () => {
        await assert.rejects(applyPendingMigrations(client, migrations, schema), permissionDenied);
      });
      await assertPermissionRollback(client, schema, null);
      assert.equal((await client.query(
        "SELECT obsolete_test_flag FROM fictional_shareholders LIMIT 1",
      )).rows[0].obsolete_test_flag, null);
    });
  }

  for (const [suffix, grants, message] of [
    ["no_table_update", "SELECT", /permission denied for table fictional_shareholders/],
    ["no_table_owner", "ALL", /must be owner of table fictional_shareholders/],
  ]) {
    await t.test(`${suffix} rolls back preceding migration DDL and data`, async () => {
      const { client, schema, role } = await restrictedFixture(postgres, suffix, { ownsTable: false });
      await client.query(`GRANT ${grants} ON fictional_shareholders TO "${role}"`);
      await asRestrictedRole(client, role, async () => {
        await assert.rejects(applyPendingMigrations(client, [permissionProbe], schema), (error) => {
          permissionDenied(error);
          assert.match(error.message, /its transaction was rolled back/);
          assert.match(error.cause.message, message);
          return true;
        });
      });
      // Ledger initialization precedes migration transactions; it remains empty.
      await assertPermissionRollback(client, schema, []);
    });
  }

  for (const [suffix, ledgerGrants] of [
    ["no_ledger_select", "INSERT"], ["no_ledger_insert", "SELECT"],
  ]) {
    await t.test(`${suffix} preserves prior ledger entries and rolls back pending changes`, async () => {
      const { client, schema, role } = await restrictedFixture(postgres, suffix);
      // Admin-owned ledger simulates an existing release managed by another role.
      await applyPendingMigrations(client, migrations, schema);
      const originalLedger = await ledger(client);
      await client.query(`GRANT ${ledgerGrants} ON "__app_schema_migrations" TO "${role}"`);
      const queue = [...migrations, permissionProbe];
      await asRestrictedRole(client, role, async () => {
        if (ledgerGrants === "INSERT") {
          await assert.rejects(getMigrationStatus(client, queue, schema), permissionDenied);
        } else {
          assert.deepEqual(await getMigrationStatus(client, queue, schema), {
            applied: migrations.map(({ version }) => version), pending: [permissionProbe],
          });
        }
        await assert.rejects(applyPendingMigrations(client, queue, schema), (error) => {
          permissionDenied(error);
          assert.match((error.cause ?? error).message, /permission denied for table __app_schema_migrations/);
          if (ledgerGrants === "SELECT") {
            assert.match(error.message, /its transaction was rolled back/);
          }
          return true;
        });
      });
      await assertPermissionRollback(client, schema, originalLedger);
    });
  }

  await t.test("cleanup stops PostgreSQL and removes all disposable files", async () => {
    await postgres.close();
    await postgres.close(); // Cleanup is safe to call again from the test hook.
    await assert.rejects(access(postgres.directory), { code: "ENOENT" });
    await assert.rejects(postgres.connect("migration_test_closed"), /already been stopped/);
  });
});
