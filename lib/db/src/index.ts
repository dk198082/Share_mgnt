import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;
let pool: pg.Pool;

const provider = process.env.DATABASE_PROVIDER ?? "replit";

if (provider === "azure") {
  const required = [
    "AZURE_PG_HOST", "AZURE_PG_DATABASE", "AZURE_PG_PORT",
    "AZURE_PG_SP_USER", "AZURE_PG_PASSWORD", "AZURE_PG_SCHEMA", "AZURE_PG_SSLMODE",
  ] as const;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Azure PostgreSQL configuration is incomplete: ${missing.join(", ")}.`);
  }

  const port = Number(process.env.AZURE_PG_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("AZURE_PG_PORT must be a valid TCP port.");
  }
  const searchPath = process.env.AZURE_PG_SCHEMA!;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(searchPath)) {
    throw new Error("AZURE_PG_SCHEMA must be a valid PostgreSQL schema name.");
  }
  const sslMode = process.env.AZURE_PG_SSLMODE!.toLowerCase();
  if (sslMode === "disable") {
    throw new Error("Azure PostgreSQL connections must use TLS.");
  }

  pool = new Pool({
    host: process.env.AZURE_PG_HOST,
    database: process.env.AZURE_PG_DATABASE,
    port,
    user: process.env.AZURE_PG_SP_USER,
    password: process.env.AZURE_PG_PASSWORD,
    ssl: { rejectUnauthorized: sslMode === "verify-ca" || sslMode === "verify-full" },
    options: `-c search_path="${searchPath}"`,
  });
} else if (provider === "replit") {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
  }
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
} else {
  throw new Error("DATABASE_PROVIDER must be either replit or azure.");
}

export { pool };
export const db = drizzle(pool, { schema });

export * from "./schema";
