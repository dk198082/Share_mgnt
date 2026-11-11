import assert from "node:assert/strict";
import test from "node:test";
import { buildAzureConnectionConfig, parseMigration } from "./azure-migration-lib.mjs";

const migrationName = "20261110090000_add_shareholder_flag.sql";

test("Azure connection configuration only uses required Azure settings and scopes the schema", () => {
  const config = buildAzureConnectionConfig({
    DATABASE_URL: "postgres://preview.invalid/preview",
    AZURE_PG_HOST: "azure.example",
    AZURE_PG_DATABASE: "shareholders",
    AZURE_PG_PORT: "5432",
    AZURE_PG_SP_USER: "app_user",
    AZURE_PG_PASSWORD: "test-only",
    AZURE_PG_SCHEMA: "Shareholdermanagement",
    AZURE_PG_SSLMODE: "require",
  });

  assert.equal(config.host, "azure.example");
  assert.equal(config.database, "shareholders");
  assert.equal(config.port, 5432);
  assert.equal(config.options, '-c search_path="Shareholdermanagement"');
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
  assert.equal("connectionString" in config, false);
});

test("Azure connection refuses missing settings, invalid schema names, and non-TLS modes", () => {
  assert.throws(
    () => buildAzureConnectionConfig({}),
    /AZURE_PG_HOST.*AZURE_PG_DATABASE/,
  );
  const valid = {
    AZURE_PG_HOST: "azure.example",
    AZURE_PG_DATABASE: "shareholders",
    AZURE_PG_PORT: "5432",
    AZURE_PG_SP_USER: "app_user",
    AZURE_PG_PASSWORD: "test-only",
    AZURE_PG_SCHEMA: "Shareholdermanagement",
    AZURE_PG_SSLMODE: "require",
  };
  assert.throws(
    () => buildAzureConnectionConfig({ ...valid, AZURE_PG_SCHEMA: 'bad"; DROP SCHEMA public; --' }),
    /valid PostgreSQL schema name/,
  );
  assert.throws(
    () => buildAzureConnectionConfig({ ...valid, AZURE_PG_SSLMODE: "disable" }),
    /must be require, verify-ca, or verify-full/,
  );
});

test("a migration must use the versioned filename and include a review header", () => {
  assert.equal(
    parseMigration(migrationName, "-- Reviewed: schema owner\nALTER TABLE shareholders ADD COLUMN flag boolean;").version,
    "20261110090000",
  );
  assert.throws(
    () => parseMigration("unversioned.sql", "-- Reviewed: owner\nSELECT 1;"),
    /Invalid migration filename/,
  );
  assert.throws(
    () => parseMigration(migrationName, "ALTER TABLE shareholders ADD COLUMN flag boolean;"),
    /must include a "-- Reviewed/,
  );
  assert.throws(
    () => parseMigration(
      migrationName,
      `\n\n\n\n\n\n\n\n\n\n-- Reviewed: too late\nALTER TABLE shareholders ADD COLUMN flag boolean;`,
    ),
    /must include a "-- Reviewed/,
  );
});

test("non-additive SQL requires an explicit approval header", () => {
  assert.throws(
    () => parseMigration(migrationName, "-- Reviewed: schema owner\nDELETE FROM shareholders;"),
    /non-additive operation/,
  );
  const migration = parseMigration(
    migrationName,
    "-- Reviewed: schema owner\n-- Explicitly approved: remove the obsolete test-only column\nALTER TABLE shareholders DROP COLUMN obsolete_flag;",
  );
  assert.equal(migration.version, "20261110090000");
});

test("comments do not trigger the non-additive SQL guard", () => {
  const migration = parseMigration(
    migrationName,
    "-- Reviewed: schema owner\n-- DROP COLUMN is not part of this additive change.\nALTER TABLE shareholders ADD COLUMN flag boolean;",
  );
  assert.ok(migration.checksum);
});
