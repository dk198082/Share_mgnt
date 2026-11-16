import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pool } from "@workspace/db";
import { auditContext } from "../lib/audit";
import { logger } from "../lib/logger";
import { requirePreviewImport, stageImport, commitImport } from "../lib/legacy-import/service";

// Deliberate operator command, not a startup hook; refuses Azure/production.
try {
  requirePreviewImport();
  const paths = process.argv.slice(2);
  const files = await Promise.all(paths.map(async path => ({
    name: basename(path), base64: (await readFile(path)).toString("base64"),
  })));
  const actor = { id: "sample-seed:replit-agent", name: "Replit Agent — requested anonymized sample load" };
  await auditContext.run(actor, async () => {
    const staged = await stageImport(files, actor);
    logger.info({ runId: staged.id, counts: staged.counts, issues: staged.issues, balances: staged.balances }, "Legacy sample validation");
    if (staged.status === "blocked") throw new Error("Blocking source validation errors; no sample records imported.");
    const result = await commitImport(staged.id, actor, true);
    logger.info({ runId: result.id, status: result.status, counts: result.counts }, "Legacy sample import completed");
  });
} finally { await pool.end(); }
