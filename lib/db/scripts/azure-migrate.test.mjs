import assert from "node:assert/strict";
import test from "node:test";
import { applyPendingMigrations, getMigrationStatus } from "./azure-migration-lib.mjs";

const schema = "Shareholdermanagement";
const migrations = [
  {
    version: "20261110090000",
    filename: "20261110090000_add_shareholder_flag.sql",
    checksum: "checksum-1",
    sql: "ALTER TABLE shareholders ADD COLUMN flag boolean;",
  },
  {
    version: "20261110100000",
    filename: "20261110100000_add_shareholder_index.sql",
    checksum: "checksum-2",
    sql: "CREATE INDEX shareholders_flag_idx ON shareholders (flag);",
  },
];

class FakeClient {
  queries = [];
  ledgerExists = false;
  ledger = new Map();

  async query(sql, params = []) {
    this.queries.push({ sql: sql.trim(), params });
    if (sql.includes("to_regclass")) {
      return { rows: [{ relation: this.ledgerExists ? "present" : null }] };
    }
    if (sql.includes("CREATE TABLE IF NOT EXISTS")) {
      this.ledgerExists = true;
    }
    if (sql.includes("SELECT version, checksum")) {
      return { rows: [...this.ledger].map(([version, checksum]) => ({ version, checksum })) };
    }
    if (sql.includes('INSERT INTO "__app_schema_migrations"')) {
      this.ledger.set(params[0], params[1]);
    }
    return { rows: [] };
  }
}

test("status is read-only and reports pending versioned migrations", async () => {
  const client = new FakeClient();
  const status = await getMigrationStatus(client, migrations, schema);

  assert.deepEqual(status.applied, []);
  assert.deepEqual(status.pending.map(({ version }) => version), [
    "20261110090000",
    "20261110100000",
  ]);
  assert.equal(client.ledgerExists, false);
  assert.equal(client.queries.some(({ sql }) => sql.startsWith("CREATE")), false);
});

test("apply runs pending migrations transactionally and records checksums", async () => {
  const client = new FakeClient();
  const applied = await applyPendingMigrations(client, migrations, schema);

  assert.deepEqual(applied, ["20261110090000", "20261110100000"]);
  assert.deepEqual([...client.ledger.keys()], applied);
  assert.equal(client.ledger.get("20261110090000"), "checksum-1");
  assert.equal(client.queries.filter(({ sql }) => sql === "BEGIN").length, 2);
  assert.equal(client.queries.filter(({ sql }) => sql === "COMMIT").length, 2);
  assert.equal(client.queries.at(-1).sql, "SELECT pg_advisory_unlock($1, $2)");
});

test("apply rejects changed migration contents before applying newer migrations", async () => {
  const client = new FakeClient();
  client.ledgerExists = true;
  client.ledger.set("20261110090000", "old-checksum");

  await assert.rejects(
    applyPendingMigrations(client, migrations, schema),
    /Applied migration 20261110090000 has changed/,
  );
  assert.equal(client.queries.some(({ sql }) => sql === "BEGIN"), false);
});

test("apply does not hide ledger entries if all migration files are missing", async () => {
  const client = new FakeClient();
  client.ledgerExists = true;
  client.ledger.set("20261110090000", "checksum-1");

  await assert.rejects(
    applyPendingMigrations(client, [], schema),
    /Applied migration 20261110090000 has no matching file/,
  );
});

test("failed migration is rolled back and is not recorded as applied", async () => {
  const client = new FakeClient();
  const originalQuery = client.query.bind(client);
  client.query = async (sql, params) => {
    if (sql === "ALTER TABLE shareholders ADD COLUMN flag boolean;") {
      throw new Error("simulated SQL failure");
    }
    return originalQuery(sql, params);
  };

  await assert.rejects(
    applyPendingMigrations(client, migrations, schema),
    /20261110090000_add_shareholder_flag.sql failed; its transaction was rolled back/,
  );
  assert.equal(client.ledger.has("20261110090000"), false);
  assert.ok(client.queries.some(({ sql }) => sql === "ROLLBACK"));
});
