import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startDisposablePostgres } from "../../../lib/db/scripts/test-support/disposable-postgres.mjs";

// Run the loader/response tests without connecting even once to an application
// database. No caller-provided database target is accepted.
const postgres = await startDisposablePostgres();
try {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [
    "--import", "tsx", "--test", "src/lib/centralized-audit.test.ts",
  ], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      DATABASE_PROVIDER: "replit",
      DATABASE_URL: `postgresql://migration_test_admin@localhost/fictional_migration_test?host=${encodeURIComponent(postgres.directory)}&sslmode=disable`,
    },
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
} finally {
  await postgres.close();
}
