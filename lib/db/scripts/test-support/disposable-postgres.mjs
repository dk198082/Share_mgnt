import { execFile } from "node:child_process";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";

const execFileAsync = promisify(execFile);

// Deliberately no connection URL, target options, or inherited PostgreSQL settings.
// This harness can only connect to the cluster that it creates itself.
export async function startDisposablePostgres() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "migration-pg-"));
  await chmod(directory, 0o700);
  const dataDirectory = path.join(directory, "data");
  const database = "fictional_migration_test";
  const clients = new Set();
  let startAttempted = false;
  let closed = false;
  const env = { PATH: process.env.PATH, LANG: "C", LC_ALL: "C", TZ: "UTC" };
  const run = (binary, args) => execFileAsync(binary, args, {
    env,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });

  async function close() {
    if (closed) return;
    await Promise.all([...clients].map((client) => client.end()));
    if (startAttempted) {
      // Never remove a data directory until PostgreSQL has stopped successfully.
      let running = false;
      try {
        await run("pg_ctl", ["-D", dataDirectory, "status"]);
        running = true;
      } catch (error) {
        if (error.code !== 3) throw error; // pg_ctl: server is not running.
      }
      if (running) {
        await run("pg_ctl", ["-D", dataDirectory, "-m", "immediate", "-w", "stop"]);
      }
    }
    await rm(directory, { recursive: true, force: true });
    closed = true;
  }

  function makeClient(databaseName, schema) {
    const client = new pg.Client({
      host: directory,
      port: 5432,
      database: databaseName,
      user: "migration_test_admin",
      password: async () => "",
      ssl: false,
      options: `-c search_path="${schema}"`,
      application_name: "disposable-migration-tests",
      connectionTimeoutMillis: 5000,
      query_timeout: 10_000,
    });
    clients.add(client);
    client.once("end", () => clients.delete(client));
    return client;
  }

  try {
    await run("initdb", [
      "-D", dataDirectory, "-U", "migration_test_admin",
      "--encoding=UTF8", "--no-locale", "--auth-local=trust", "--auth-host=reject",
    ]);
    startAttempted = true;
    await run("pg_ctl", [
      "-D", dataDirectory, "-l", path.join(directory, "postgres.log"), "-w",
      "-o", `-F -c listen_addresses='' -c unix_socket_directories='${directory}' -p 5432`,
      "start",
    ]);
    const admin = makeClient("postgres", "public");
    await admin.connect();
    await admin.query(`CREATE DATABASE ${database}`);
    await admin.end();
    return {
      directory,
      async connect(schema) {
        if (closed) throw new Error("Disposable PostgreSQL has already been stopped.");
        if (!/^migration_test_[a-z0-9_]+$/.test(schema)) {
          throw new Error("Tests require a migration_test_ prefixed schema.");
        }
        const client = makeClient(database, schema);
        await client.connect();
        await client.query(`CREATE SCHEMA "${schema}"`);
        return client;
      },
      close,
    };
  } catch (error) {
    await close();
    throw new Error(
      "Disposable PostgreSQL setup failed. PostgreSQL initdb and pg_ctl must be on PATH; run as a non-root user.",
      { cause: error },
    );
  }
}
