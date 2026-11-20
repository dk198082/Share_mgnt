import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as definitions from "../src/schema/index.ts";
import { startDisposablePostgres } from "./test-support/disposable-postgres.mjs";

const run = promisify(execFile);
const work = await mkdtemp(path.join(tmpdir(), "shareholder-browser-"));
const env = { PATH: process.env.PATH, HOME: work, TZ: "UTC" };
const web = new URL("../../../artifacts/shareholder-management/", import.meta.url);
const scripts = new URL("../../../scripts/", import.meta.url);
const postgres = await startDisposablePostgres().catch(async error => {
  await rm(work, { recursive: true, force: true });
  throw error;
});
try {
  const client = await postgres.connect("migration_test_browser_permissions");
  try {
    await client.query("SET search_path TO public");
    for (const statement of await generateMigration(generateDrizzleJson({}), generateDrizzleJson(definitions))) {
      await client.query(statement);
    }
  } finally { await client.end(); }
  const cert = path.join(work, "cert.pem");
  await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", path.join(work, "key.pem"), "-out", cert], { env, timeout: 30_000 });
  try {
    await run("pnpm", ["run", "build", "--outDir", path.join(work, "web")], {
      cwd: web, env: { ...env, BASE_PATH: "/", PORT: "3000" }, timeout: 120_000,
    });
  } catch (error) {
    process.stderr.write((error.stdout ?? "") + (error.stderr ?? ""));
    throw error;
  }
  // Whitelist only browser installation locations from the outer process, never application configuration.
  const browserSettings = Object.fromEntries(["PLAYWRIGHT_BROWSERS_PATH", "BROWSER_EXECUTABLE"]
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  if (!browserSettings.PLAYWRIGHT_BROWSERS_PATH && process.env.HOME) {
    browserSettings.PLAYWRIGHT_BROWSERS_PATH = path.join(process.env.HOME, ".cache", "ms-playwright");
  }
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--test", "--test-isolation=none", "src/role-regression/permissions.browser.test.mjs"], {
      cwd: scripts, stdio: "inherit", timeout: 150_000,
      env: { ...env, ...browserSettings, NODE_ENV: "test", NODE_EXTRA_CA_CERTS: cert,
        BROWSER_TEST_WORK: work, DATABASE_PROVIDER: "replit",
        DATABASE_URL: `postgresql://migration_test_admin@localhost/fictional_migration_test?host=${encodeURIComponent(postgres.directory)}&sslmode=disable`,
      },
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Browser permission suite failed (${signal ?? code}).`)));
  });
} finally {
  try { await postgres.close(); }
  finally { await rm(work, { recursive: true, force: true }); }
}
