import pg from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  applyPendingMigrations,
  buildAzureConnectionConfig,
  getMigrationStatus,
  loadMigrations,
} from "./azure-migration-lib.mjs";

const action = process.argv[2];
if (!["status", "apply"].includes(action)) {
  console.error("Usage: pnpm --filter @workspace/db run azure:migrations:status|azure:migrations:apply");
  process.exit(2);
}

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
let client;

try {
  const migrations = await loadMigrations(migrationsDirectory);
  const connectionConfig = buildAzureConnectionConfig(process.env);
  const schema = process.env.AZURE_PG_SCHEMA;
  client = new pg.Client(connectionConfig);
  await client.connect();

  if (action === "status") {
    const status = await getMigrationStatus(client, migrations, schema);
    console.log(`Azure schema ${schema}: ${status.applied.length} applied, ${status.pending.length} pending.`);
    for (const migration of status.pending) {
      console.log(`PENDING ${migration.filename}`);
    }
  } else {
    const applied = await applyPendingMigrations(client, migrations, schema);
    if (applied.length === 0) {
      console.log(`Azure schema ${schema}: no pending migrations.`);
    } else {
      for (const version of applied) {
        console.log(`APPLIED ${version}`);
      }
      console.log(`Azure schema ${schema}: applied ${applied.length} migration(s).`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Azure migration failed.");
  process.exitCode = 1;
} finally {
  if (client) {
    await client.end().catch(() => {});
  }
}
