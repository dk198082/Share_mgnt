import pg from "pg";
import { generateDrizzleJson } from "drizzle-kit/api";
import * as definitions from "../src/schema/index.ts";
import { buildAzureConnectionConfig } from "./azure-migration-lib.mjs";
import { readAzureSchema } from "./azure-schema-catalog.mjs";
import { compareSchemas, expectedSchema } from "./azure-schema-model.mjs";

// Validate Azure configuration before constructing a client. No DATABASE_URL fallback.
let client;
let phase = "configuration";
try {
  if (process.argv.length > 2) {
    throw new Error("Usage: pnpm --filter @workspace/db run azure:schema:check");
  }
  const config = buildAzureConnectionConfig(process.env);
  const schema = process.env.AZURE_PG_SCHEMA;
  phase = "expected schema";
  const expected = expectedSchema(generateDrizzleJson(definitions), schema);
  phase = "connection or catalog inspection";
  client = new pg.Client({
    ...config, connectionTimeoutMillis: 10000,
    options: `${config.options} -c default_transaction_read_only=on -c statement_timeout=15000`,
  });
  await client.connect();
  const actual = await readAzureSchema(client, schema);
  const differences = compareSchemas(expected, actual);
  console.log(JSON.stringify({
    version: 1, schema, status: differences.length ? "drift" : "match", differences,
  }, null, 2));
  // Releases must fail closed: drift is 1; an incomplete comparison is 2.
  process.exitCode = differences.length ? 1 : 0;
} catch (error) {
  // Server/driver/parser errors can contain SQL literals or connection details.
  // Only locally-authored configuration errors are safe to show.
  console.error(phase === "configuration" ? error.message :
    `Azure schema check failed during ${phase}; no successful comparison was produced. Check access, PostgreSQL version, and supported schema definitions. Database error details are withheld.`);
  process.exitCode = 2;
} finally {
  if (client) await client.end().catch(() => {});
}
