// Owns a new private PostgreSQL cluster. Cannot target Preview or Azure.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as definitions from "../src/schema/index.ts";
import { startDisposablePostgres } from "./test-support/disposable-postgres.mjs";
import { readAzureSchema } from "./azure-schema-catalog.mjs";
import { compareSchemas, expectedSchema } from "./azure-schema-model.mjs";

const postgres = await startDisposablePostgres();
try {
  const client = await postgres.connect("migration_test_quantities");
  await client.query("SET search_path TO public");
  // Construct a fresh baseline from today's declarations, but with the previous
  // three bigint columns, to exercise the real lossless widening SQL.
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(definitions));
  let replaced = 0;
  for (const statement of statements) {
    const baseline = statement.replace(/("(?:quantity|transferred_quantity)") numeric\(15,\s*2\)/g, (_, col) => {
      replaced++;
      return `${col} bigint`;
    });
    await client.query(baseline);
  }
  assert.equal(replaced, 3, "Must exercise all three former bigint columns.");
  await client.query(`INSERT INTO shareholders(id,data) VALUES ('widening-owner','{"name":"Synthetic widening fixture"}')`);
  await client.query(`INSERT INTO certificates
    (id,sequence_number,shareholder_id,share_class,quantity,transferred_quantity,vesting_schedule,request_id,issued_by)
    VALUES ('C-800',800,'widening-owner','Common',1000000000000,0,'Legacy fixture','widening-fixture','synthetic')`);
  const migration = await readFile(new URL("../migrations/20261113170000_two_decimal_share_quantities.sql", import.meta.url), "utf8");
  await client.query("BEGIN");
  await client.query(migration);
  await client.query("COMMIT");
  const row = (await client.query("SELECT quantity::text, transferred_quantity::text FROM certificates WHERE id='C-800'")).rows[0];
  assert.deepEqual(row, { quantity: "1000000000000.00", transferred_quantity: "0.00" });
  const expected = expectedSchema(generateDrizzleJson(definitions), "public");
  assert.deepEqual(compareSchemas(expected, await readAzureSchema(client, "public")), [],
    "The widened baseline must match current schema declarations.");
  // The child test suites use only this cluster's public schema. No app
  // connection string or production secrets are passed through.
  await client.query("DELETE FROM certificates WHERE id='C-800'");
  await client.query("DELETE FROM shareholders WHERE id='widening-owner'");
  await client.end();
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [
    "--import", "tsx", "--test",
    "src/lib/share-quantities.test.ts", "src/lib/certificates.test.ts",
    "src/lib/reports.test.ts", "src/lib/certificate-pdf.test.ts",
    "src/lib/approval-workflow.test.ts",
  ], {
    cwd: new URL("../../../artifacts/api-server/", import.meta.url),
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test",
      DATABASE_PROVIDER: "replit",
      DATABASE_URL: `postgresql://migration_test_admin@localhost/fictional_migration_test?host=${encodeURIComponent(postgres.directory)}&sslmode=disable`,
    },
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.stdout.write("Lossless bigint-to-decimal migration verified on the private synthetic cluster.\n");
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  await postgres.close();
}
