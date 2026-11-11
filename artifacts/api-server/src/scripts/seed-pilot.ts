/** Explicit development CLI; the same dataset is available as an authenticated Settings action. */
import { db, pool } from "@workspace/db";
import { auditContext } from "../lib/audit";
import { importPilotDataInTransaction } from "../lib/pilot-data";

async function main() {
  if (process.env.NODE_ENV !== "development" || !process.argv.includes("--confirm-development")) {
    throw new Error("Run only against development: NODE_ENV=development tsx src/scripts/seed-pilot.ts --confirm-development");
  }
  const actor = "Pilot data import (fictional; no approvals)";
  const result = await auditContext.run({ id: actor, name: actor },
    () => db.transaction(tx => importPilotDataInTransaction(tx, actor)));
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
