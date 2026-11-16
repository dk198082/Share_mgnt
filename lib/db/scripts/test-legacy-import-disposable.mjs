import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as definitions from "../src/schema/index.ts";
import { startDisposablePostgres } from "./test-support/disposable-postgres.mjs";

// Owns its cluster. Does not accept any target URL or external database override.
const postgres = await startDisposablePostgres();
try {
  const client = await postgres.connect("migration_test_legacy_import");
  await client.query("SET search_path TO public");
  for (const statement of await generateMigration(generateDrizzleJson({}), generateDrizzleJson(definitions))) await client.query(statement);
  await client.end();
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [
    "--import", "tsx", "--test", "--test-concurrency=1",
    "src/lib/legacy-import/import.test.ts", "src/lib/legacy-import/access.test.ts",
    "src/lib/pilot-auth.test.ts", "src/lib/pilot-auth-flow.test.ts",
  ], {
    cwd: new URL("../../../artifacts/api-server/", import.meta.url),
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "development",
      DATABASE_PROVIDER: "replit", LEGACY_IMPORT_TEST_CLUSTER: "owned-disposable",
      DATABASE_URL: `postgresql://migration_test_admin@localhost/fictional_migration_test?host=${encodeURIComponent(postgres.directory)}&sslmode=disable`,
    }, timeout: 120000, maxBuffer: 2 * 1024 * 1024,
  });
  process.stdout.write(stdout); process.stderr.write(stderr);
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally { await postgres.close(); }
