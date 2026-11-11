import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as definitions from "../src/schema/index.ts";
import {
  CATALOG_QUERIES, MIN_POSTGRES_VERSION_NUM, SERVER_VERSION_QUERY, readAzureSchema,
} from "./azure-schema-catalog.mjs";
import { compareSchemas, expectedSchema, normalizeExpression } from "./azure-schema-model.mjs";
import { buildAzureConnectionConfig } from "./azure-migration-lib.mjs";

const schema = "Azure_Test";
const expected = expectedSchema(generateDrizzleJson(definitions), schema);

function catalogFixture() {
  return {
    serverVersion: [{ server_version_num: 160010 }],
    tables: [{ name: "certificates", kind: "r", rls: false, force_rls: false }],
    columns: [{
      table_name: "certificates", name: "status", type: "text", not_null: true,
      default_expression: "'Outstanding'::text", generated: "", identity: "", serial_sequence: null,
      default_collation: true,
    }],
    constraints: [{
      table_name: "certificates", name: "certificate_status_valid", kind: "c",
      deferrable: false, deferred: false, validated: true, no_inherit: false,
      expression: "(status = ANY (ARRAY['Outstanding'::text, 'Partially Transferred'::text, 'Transferred'::text, 'Cancelled'::text]))",
    }],
    indexes: [{
      table_name: "certificates", name: "status_idx", unique: false, method: "btree",
      valid: true, ready: true, nulls_not_distinct: false, include: [],
      expressions: ["status"], ascending: [true], nulls: ["last"], predicate: null,
      default_opclasses: [true], default_collations: [true], storage_parameters: [],
    }],
  };
}

function fakeClient(fixture = catalogFixture()) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (sql === SERVER_VERSION_QUERY) return { rows: fixture.serverVersion };
      const kind = Object.keys(CATALOG_QUERIES).find((key) => CATALOG_QUERIES[key] === sql);
      return { rows: kind ? fixture[kind] : [] };
    },
  };
}

test("loads the current Drizzle exports offline, including serial columns and constraints", () => {
  assert.ok(Object.keys(expected.tables).length > 10);
  assert.equal(expected.tables.share_price_history.columns.id.type, "integer");
  assert.equal(expected.tables.share_price_history.columns.id.serialSequence, `${schema}.share_price_history_id_seq`);
  assert.equal(expected.tables.certificates.constraints.certificate_status_valid.kind, "c");
  assert.equal(expected.tables.certificates.constraints.certificates_shareholder_id_shareholders_id_fk.foreignSchema, schema);
  assert.equal(expected.tables.users.columns.email.type, "character varying");
});

test("identical schemas match; missing tables, columns, indexes and constraints are reported", () => {
  assert.deepEqual(compareSchemas(expected, structuredClone(expected)), []);
  const actual = structuredClone(expected);
  delete actual.tables.users;
  delete actual.tables.certificates.columns.quantity;
  delete actual.tables.certificates.indexes.certificate_class_sequence_unique;
  delete actual.tables.certificates.constraints.certificate_status_valid;
  const differences = compareSchemas(expected, actual);
  assert.deepEqual(differences.map(({ kind, status }) => [kind, status]).sort(), [
    ["column", "missing"], ["constraint", "missing"], ["index", "missing"], ["table", "missing"],
  ]);
});

test("detects changed columns, indexes, check values, keys and foreign-key actions without printing definitions", () => {
  const actual = structuredClone(expected);
  actual.tables.certificates.columns.quantity.type = "integer";
  actual.tables.certificates.columns.status.default = "sensitive definition not for output";
  actual.tables.certificates.constraints.certificate_status_valid.expression =
    normalizeExpression("status IN ('Outstanding', 'Cancelled')", "certificates");
  actual.tables.certificates.constraints.certificates_shareholder_id_shareholders_id_fk.onDelete = "cascade";
  actual.tables.certificates.constraints.certificates_request_id_unique.columns = ["id"];
  actual.tables.certificates.indexes.certificate_class_sequence_unique.columns.reverse();
  actual.tables.certificates.indexes.certificate_class_sequence_unique.valid = false;
  const differences = compareSchemas(expected, actual);
  assert.equal(differences.length, 6);
  assert.ok(differences.every((difference) => difference.status === "changed"));
  assert.ok(differences.some((difference) => difference.fields.includes("onDelete")));
  assert.ok(!JSON.stringify(differences).includes("sensitive"));
});

test("unexpected objects are reported, not silently ignored", () => {
  const actual = structuredClone(expected);
  actual.tables.extra = { columns: {}, indexes: {}, constraints: {}, rls: false, forceRls: false };
  actual.tables.certificates.columns.extra = { type: "text" };
  actual.tables.certificates.indexes.extra = {};
  actual.tables.certificates.constraints.extra = {};
  assert.equal(compareSchemas(expected, actual).filter((item) => item.status === "unexpected").length, 4);
});

test("normalizes PostgreSQL formatting without losing grouping, literal case, or casts on columns", () => {
  assert.equal(
    normalizeExpression('"certificates"."status" IN (\'Outstanding\', \'Cancelled\')', "certificates"),
    normalizeExpression("(status = ANY (ARRAY['Outstanding'::text, 'Cancelled'::text]))", "certificates"),
  );
  assert.equal(normalizeExpression("'Outstanding'", "certificates", "text"),
    normalizeExpression("('Outstanding'::text)", "certificates", "text"));
  assert.equal(normalizeExpression('a > 0 AND b <= 1000000000000', "t"),
    normalizeExpression('((a > 0) AND (b <= 1000000000000))', "t"));
  assert.notEqual(normalizeExpression("(a OR b) AND c", "t"), normalizeExpression("a OR (b AND c)", "t"));
  assert.notEqual(normalizeExpression("'Cancelled'", "t"), normalizeExpression("'cancelled'", "t"));
  assert.notEqual(normalizeExpression("a::text", "t"), normalizeExpression("a", "t"));
  assert.notEqual(normalizeExpression("1::numeric / 2", "t", "numeric"), normalizeExpression("1 / 2", "t", "numeric"));
});

test("catalog reader matches real PostgreSQL-shaped metadata under a read-only consistent transaction", async () => {
  const client = fakeClient();
  const actual = await readAzureSchema(client, schema);
  const minimalExpected = structuredClone(actual);
  minimalExpected.tables.certificates.columns.status = expected.tables.certificates.columns.status;
  minimalExpected.tables.certificates.constraints.certificate_status_valid =
    expected.tables.certificates.constraints.certificate_status_valid;
  assert.deepEqual(compareSchemas(minimalExpected, actual), []);
  assert.equal(client.queries[0].sql, "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(client.queries.at(-1).sql, "COMMIT");
  assert.ok(client.queries.some(({ sql }) => sql === SERVER_VERSION_QUERY));
  for (const { sql, params } of client.queries.filter(({ sql }) => Object.values(CATALOG_QUERIES).includes(sql))) {
    assert.match(sql.trim(), /^SELECT/);
    assert.deepEqual(params, [schema]);
    assert.match(sql, /pg_catalog/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
    assert.doesNotMatch(sql, /\bFROM\s+(?:"?shareholders"?|"?certificates"?)/i);
  }
});

test("ignores only the migration ledger, without reading it", async () => {
  const fixture = catalogFixture();
  fixture.tables.push({ name: "__app_schema_migrations", rls: false, force_rls: false });
  const actual = await readAzureSchema(fakeClient(fixture), schema);
  assert.deepEqual(Object.keys(actual.tables), ["certificates"]);
});

test("rolls back on catalog/permission failure instead of claiming a match", async () => {
  const client = fakeClient();
  const query = client.query.bind(client);
  client.query = async (sql, params) => {
    if (sql === CATALOG_QUERIES.columns) throw new Error("permission denied");
    return query(sql, params);
  };
  await assert.rejects(readAzureSchema(client, schema), /permission denied/);
  assert.equal(client.queries.at(-1).sql, "ROLLBACK");
  assert.ok(!client.queries.some(({ sql }) => sql === "COMMIT"));
});

test("unsupported expression metadata fails closed and rolls back", async () => {
  const fixture = catalogFixture();
  fixture.columns[0].default_expression = "unsupported syntax must not be evaluated";
  const client = fakeClient(fixture);
  await assert.rejects(readAzureSchema(client, schema));
  assert.equal(client.queries.at(-1).sql, "ROLLBACK");
});

test("unsupported PostgreSQL versions and catalog object kinds fail closed", async () => {
  assert.equal(MIN_POSTGRES_VERSION_NUM, 150000);
  const oldVersion = catalogFixture();
  oldVersion.serverVersion = [{ server_version_num: 140024 }];
  const oldVersionClient = fakeClient(oldVersion);
  await assert.rejects(readAzureSchema(oldVersionClient, schema), /PostgreSQL 15 or newer/);
  assert.equal(oldVersionClient.queries.at(-1).sql, "ROLLBACK");
  assert.equal(oldVersionClient.queries.some(({ sql }) => sql === CATALOG_QUERIES.columns), false);

  const unsupportedRelation = catalogFixture();
  unsupportedRelation.tables[0].kind = "v";
  const relationClient = fakeClient(unsupportedRelation);
  await assert.rejects(readAzureSchema(relationClient, schema), /Unsupported relation metadata/);
  assert.equal(relationClient.queries.at(-1).sql, "ROLLBACK");

  const unsupportedConstraint = catalogFixture();
  unsupportedConstraint.constraints[0].kind = "x";
  const constraintClient = fakeClient(unsupportedConstraint);
  await assert.rejects(readAzureSchema(constraintClient, schema), /Unsupported constraint metadata/);
  assert.equal(constraintClient.queries.at(-1).sql, "ROLLBACK");
});

test("missing Azure settings fail before connecting, even when Preview DATABASE_URL exists", () => {
  assert.throws(() => buildAzureConnectionConfig({ DATABASE_URL: "postgres://preview.invalid/preview" }),
    /configuration is incomplete/);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith("AZURE_PG_") && !key.startsWith("PG") && key !== "DATABASE_URL"));
  env.DATABASE_URL = "postgres://do-not-read:do-not-print@preview.invalid/preview";
  const result = spawnSync(process.execPath, ["--import", "tsx", "./scripts/azure-schema-check.mjs"], {
    cwd: new URL("../", import.meta.url), env, encoding: "utf8", timeout: 20000,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Azure PostgreSQL configuration is incomplete/);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /do-not-read|do-not-print|preview.invalid/);
});

test("unsafe schema identifiers and TLS settings are refused", () => {
  const env = {
    AZURE_PG_HOST: "azure.invalid", AZURE_PG_DATABASE: "test", AZURE_PG_PORT: "5432",
    AZURE_PG_SP_USER: "test", AZURE_PG_PASSWORD: "test", AZURE_PG_SCHEMA: schema, AZURE_PG_SSLMODE: "verify-full",
  };
  assert.throws(() => buildAzureConnectionConfig({ ...env, AZURE_PG_SCHEMA: 'public"; DROP TABLE x;--' }), /schema name/);
  assert.throws(() => buildAzureConnectionConfig({ ...env, AZURE_PG_SSLMODE: "disable" }), /SSL/);
});

function postgresMatrix() {
  const configured = process.env.SCHEMA_TEST_POSTGRES_BINARIES;
  if (configured) {
    let binaries;
    try {
      binaries = JSON.parse(configured);
    } catch {
      throw new Error("SCHEMA_TEST_POSTGRES_BINARIES must be a JSON object of PostgreSQL major versions to bin directories.");
    }
    const majors = Object.keys(binaries).sort();
    assert.deepEqual(majors, ["15", "16", "17", "18"],
      "SCHEMA_TEST_POSTGRES_BINARIES must include PostgreSQL 15, 16, 17, and 18.");
    for (const directory of Object.values(binaries)) {
      assert.equal(typeof directory, "string");
      assert.ok(path.isAbsolute(directory), "PostgreSQL binary directories must be absolute paths.");
    }
    return Object.entries(binaries).map(([major, binDirectory]) => ({
      major: Number(major), binDirectory,
    }));
  }
  const version = spawnSync("postgres", ["--version"], { encoding: "utf8" });
  const match = version.status === 0 && version.stdout.match(/\bPostgreSQL\)\s+(\d+)\./);
  return match && Number(match[1]) >= 15 ? [{ major: Number(match[1]), binDirectory: null }] : [];
}

const postgresVersions = postgresMatrix();
const hasPostgresBinaries = postgresVersions.length > 0 &&
  postgresVersions.every(({ binDirectory }) => {
    const initdb = binDirectory ? path.join(binDirectory, "initdb") : "initdb";
    const pgCtl = binDirectory ? path.join(binDirectory, "pg_ctl") : "pg_ctl";
    return spawnSync(initdb, ["--version"]).status === 0 && spawnSync(pgCtl, ["--version"]).status === 0;
  });
if (process.env.SCHEMA_TEST_POSTGRES_BINARIES && !hasPostgresBinaries) {
  throw new Error("The configured PostgreSQL matrix must provide working initdb and pg_ctl binaries for every major.");
}

test("disposable PostgreSQL versions match Drizzle and detect metadata-only drift", {
  skip: !hasPostgresBinaries,
  timeout: 300000,
}, async (t) => {
  for (const { major, binDirectory } of postgresVersions) {
    await t.test(`PostgreSQL ${major}`, { timeout: 60000 }, async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "schema-drift-"));
      const data = path.join(directory, "data");
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !key.startsWith("PG") && !key.startsWith("AZURE_PG_") && key !== "DATABASE_URL"));
      let started = false;
      let client;
      const binary = (name) => binDirectory ? path.join(binDirectory, name) : name;
      function command(name, args) {
        const executable = binary(name);
        const result = spawnSync(executable, args, { env, encoding: "utf8", timeout: 20000 });
        assert.equal(result.status, 0, `${executable}: ${result.stderr}`);
      }
      try {
        const version = spawnSync(binary("postgres"), ["--version"], { encoding: "utf8" });
        assert.equal(version.status, 0, version.stderr);
        const versionMatch = version.stdout.match(/\bPostgreSQL\)\s+(\d+)\./);
        assert.equal(Number(versionMatch?.[1]), major, version.stdout);
        command("initdb", ["-D", data, "-A", "trust", "-U", "drift_test", "--no-locale", "-E", "UTF8"]);
        command("pg_ctl", ["-D", data, "-l", path.join(directory, "postgres.log"),
          "-o", `-F -k ${directory} -h ''`, "-w", "start"]);
        started = true;
        client = new pg.Client({ host: directory, database: "postgres", user: "drift_test", port: 5432 });
        await client.connect();
        await client.query(`CREATE SCHEMA "${schema}"`);
        await client.query(`SET search_path TO "${schema}"`);
        const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(definitions));
        for (const statement of statements) {
          await client.query(statement.replaceAll('"public".', `"${schema}".`));
        }
        // The inspector itself must work without table-data privileges.
        await client.query("CREATE ROLE catalog_only");
        await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO catalog_only`);
        await client.query("SET ROLE catalog_only");
        await assert.rejects(client.query("SELECT * FROM certificates"), /permission denied/);
        assert.deepEqual(compareSchemas(expected, await readAzureSchema(client, schema)), []);
        await client.query("RESET ROLE");
        await client.query("ALTER TABLE certificates DROP CONSTRAINT certificate_status_valid");
        await client.query("ALTER TABLE certificates ADD CONSTRAINT certificate_status_valid CHECK (status IN ('Outstanding', 'Cancelled')) NOT VALID");
        await client.query("DROP INDEX certificate_class_sequence_unique");
        await client.query("CREATE INDEX certificate_class_sequence_unique ON certificates (sequence_number DESC, share_class)");
        await client.query("ALTER TABLE certificates ALTER COLUMN quantity TYPE numeric(24,6)");
        const differences = compareSchemas(expected, await readAzureSchema(client, schema));
        assert.ok(differences.some((item) => item.kind === "constraint" && item.fields.includes("expression") && item.fields.includes("validated")));
        assert.ok(differences.some((item) => item.kind === "index" && item.fields.includes("columns") && item.fields.includes("unique")));
        assert.ok(differences.some((item) => item.kind === "column" && item.fields.includes("type")));
      } finally {
        if (client) await client.end();
        if (started) spawnSync(binary("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], { env, timeout: 20000 });
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});
