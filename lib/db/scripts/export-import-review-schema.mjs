// Documentation only: loads schema definitions, never the DB client or env config.
import { generateDrizzleJson } from "drizzle-kit/api";
import * as definitions from "../src/schema/index.ts";
import { writeFile } from "node:fs/promises";

const snapshot = generateDrizzleJson(definitions);
const tables = Object.values(snapshot.tables).sort((a, b) => a.name.localeCompare(b.name));
const catalog = {
  basis: "Current code-defined application schema; not a live database inspection",
  tables,
};
const output = new URL("../../../docs/legacy-import/destination-schema.json", import.meta.url);
await writeFile(output, JSON.stringify(catalog, null, 2) + "\n");
console.log(`Documented ${tables.length} tables and ${tables.reduce((n, t) => n + Object.keys(t.columns).length, 0)} columns without opening a database connection.`);
