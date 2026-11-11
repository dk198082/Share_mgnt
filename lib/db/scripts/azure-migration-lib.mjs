import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const MIGRATION_FILENAME = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const REQUIRED_AZURE_ENV = [
  "AZURE_PG_HOST",
  "AZURE_PG_DATABASE",
  "AZURE_PG_PORT",
  "AZURE_PG_SP_USER",
  "AZURE_PG_PASSWORD",
  "AZURE_PG_SCHEMA",
  "AZURE_PG_SSLMODE",
];
const NON_ADDITIVE_SQL =
  /\b(?:DROP|TRUNCATE|DELETE|UPDATE|RENAME)\b|\bALTER\s+(?:COLUMN|TYPE)\b|\bSET\s+NOT\s+NULL\b/i;

export function buildAzureConnectionConfig(env) {
  const missing = REQUIRED_AZURE_ENV.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Azure PostgreSQL configuration is incomplete: ${missing.join(", ")}.`);
  }

  const port = Number(env.AZURE_PG_PORT);
  if (!/^\d+$/.test(env.AZURE_PG_PORT) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("AZURE_PG_PORT must be a valid TCP port.");
  }

  const schema = env.AZURE_PG_SCHEMA;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error("AZURE_PG_SCHEMA must be a valid PostgreSQL schema name.");
  }

  const sslMode = env.AZURE_PG_SSLMODE.toLowerCase();
  if (!["require", "verify-ca", "verify-full"].includes(sslMode)) {
    throw new Error("AZURE_PG_SSLMODE must be require, verify-ca, or verify-full.");
  }

  return {
    host: env.AZURE_PG_HOST,
    database: env.AZURE_PG_DATABASE,
    port,
    user: env.AZURE_PG_SP_USER,
    password: env.AZURE_PG_PASSWORD,
    ssl: { rejectUnauthorized: sslMode === "verify-ca" || sslMode === "verify-full" },
    options: `-c search_path="${schema}"`,
  };
}

export function parseMigration(filename, sql) {
  const match = MIGRATION_FILENAME.exec(filename);
  if (!match) {
    throw new Error(
      `Invalid migration filename "${filename}". Use YYYYMMDDHHMMSS_lowercase_description.sql.`,
    );
  }
  if (!sql.trim()) {
    throw new Error(`Migration "${filename}" is empty.`);
  }

  const header = sql.split(/\r?\n/).slice(0, 10).join("\n");
  const reviewed = /^\s*--\s*reviewed:\s*\S.+$/im.test(header);
  if (!reviewed) {
    throw new Error(`Migration "${filename}" must include a "-- Reviewed: ..." header.`);
  }

  const sqlWithoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ");
  const nonAdditive = NON_ADDITIVE_SQL.test(sqlWithoutComments);
  const explicitlyApproved = /^\s*--\s*explicitly approved:\s*\S.+$/im.test(header);
  if (nonAdditive && !explicitlyApproved) {
    throw new Error(
      `Migration "${filename}" contains a non-additive operation and must include a "-- Explicitly approved: ..." header.`,
    );
  }

  return {
    version: match[1],
    name: match[2],
    filename,
    sql,
    checksum: createHash("sha256").update(sql).digest("hex"),
  };
}

export async function loadMigrations(migrationsDirectory) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrationFiles = entries
    .filter((entry) => entry.name.endsWith(".sql"))
    .sort((left, right) => left.name.localeCompare(right.name));

  const migrations = [];
  let previousVersion = "";
  for (const entry of migrationFiles) {
    if (!entry.isFile()) {
      throw new Error(`Migration path "${entry.name}" must be a regular file.`);
    }

    const migration = parseMigration(
      entry.name,
      await readFile(path.join(migrationsDirectory, entry.name), "utf8"),
    );
    if (migration.version <= previousVersion) {
      throw new Error(`Migration version "${migration.version}" is duplicated or out of order.`);
    }
    previousVersion = migration.version;
    migrations.push(migration);
  }
  return migrations;
}

function quoteSchema(schema) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error("Azure PostgreSQL schema name is invalid.");
  }
  return `"${schema}"`;
}

async function readAppliedMigrations(client, migrations, schema) {
  const ledger = `${quoteSchema(schema)}."__app_schema_migrations"`;
  const relation = await client.query("SELECT to_regclass($1) AS relation", [ledger]);
  if (!relation.rows[0]?.relation) {
    return { applied: [], pending: migrations };
  }

  const result = await client.query(
    'SELECT version, checksum FROM "__app_schema_migrations" ORDER BY version',
  );
  const filesByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  const appliedByVersion = new Map(result.rows.map((row) => [row.version, row.checksum]));

  for (const [version, checksum] of appliedByVersion) {
    const migration = filesByVersion.get(version);
    if (!migration) {
      throw new Error(
        `Applied migration ${version} has no matching file. Restore the file; migration history cannot be removed.`,
      );
    }
    if (migration.checksum !== checksum) {
      throw new Error(
        `Applied migration ${version} has changed. Restore its original contents and add a new migration instead.`,
      );
    }
  }

  return {
    applied: [...appliedByVersion.keys()].sort(),
    pending: migrations.filter((migration) => !appliedByVersion.has(migration.version)),
  };
}

export async function getMigrationStatus(client, migrations, schema) {
  return readAppliedMigrations(client, migrations, schema);
}

export async function applyPendingMigrations(client, migrations, schema) {
  const initialStatus = await readAppliedMigrations(client, migrations, schema);
  if (initialStatus.pending.length === 0) {
    return [];
  }

  const lockKeys = [183510229, 772024];
  await client.query("SELECT pg_advisory_lock($1, $2)", lockKeys);
  const applied = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "__app_schema_migrations" (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { pending } = await readAppliedMigrations(client, migrations, schema);

    for (const migration of pending) {
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO "__app_schema_migrations" (version, checksum) VALUES ($1, $2)',
          [migration.version, migration.checksum],
        );
        await client.query("COMMIT");
        applied.push(migration.version);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migration.filename} failed; its transaction was rolled back.`, {
          cause: error,
        });
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, $2)", lockKeys);
  }
  return applied;
}
