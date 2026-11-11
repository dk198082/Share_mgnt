import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { GetPilotDataStatusResponse, ImportPilotDataBody, ImportPilotDataResponse } from "@workspace/api-zod";
import { CertificateError } from "../lib/certificates";
import { importPilotDataInTransaction, pilotDataStatus } from "../lib/pilot-data";

const router: IRouter = Router();
// Mounted behind Settings' pilot authentication and same-origin write guard.
router.get("/pilot-data", async (_req, res) => {
  const status = await db.transaction(pilotDataStatus, { isolationLevel: "repeatable read", accessMode: "read only" });
  res.set("Cache-Control", "no-store").json(GetPilotDataStatusResponse.parse(status));
});
router.post("/pilot-data", async (req, res) => {
  const parsed = ImportPilotDataBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Confirm that you want to import fictional pilot data." }); return; }
  try {
    const result = await db.transaction(tx => importPilotDataInTransaction(tx, req.user!.id));
    res.json(ImportPilotDataResponse.parse(result));
  } catch (error) {
    if (error instanceof CertificateError) { res.status(error.status).json({ error: error.message }); return; }
    req.log.error({ err: error }, "Pilot import rolled back");
    res.status(500).json({ error: "The pilot import could not be completed. No partial import was saved. You can safely retry." });
  }
});
export default router;
