import { Router, type IRouter } from "express";
import {
  AdvanceCertificateCounterBody, AdvanceCertificateCounterResponse,
  GetCertificateCountersResponse,
} from "@workspace/api-zod";
import { requireEmployee, requireEditor } from "../middlewares/employee";
import { CertificateError } from "../lib/certificates";
import {
  advanceCertificateCounter, CERTIFICATE_SHARE_CLASSES, readCertificateCounters,
} from "../lib/certificate-counters";
import { db } from "@workspace/db";

const router: IRouter = Router();
router.get("/settings/certificate-counters", requireEmployee, async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.json(GetCertificateCountersResponse.parse(await readCertificateCounters()));
});

router.put("/settings/certificate-counters/:shareClass", requireEmployee, requireEditor, async (req, res): Promise<void> => {
  const shareClass = Array.isArray(req.params.shareClass) ? req.params.shareClass[0] : req.params.shareClass;
  if (!CERTIFICATE_SHARE_CLASSES.includes(shareClass as typeof CERTIFICATE_SHARE_CLASSES[number])) {
    res.status(400).json({ error: "Choose Common or Preferred." });
    return;
  }
  const parsed = AdvanceCertificateCounterBody.strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a higher whole next number and a reason of up to 2,000 characters." });
    return;
  }
  try {
    await db.transaction(tx => advanceCertificateCounter(tx, shareClass as typeof CERTIFICATE_SHARE_CLASSES[number],
      parsed.data.nextNumber, parsed.data.reason));
    const state = (await readCertificateCounters()).find(row => row.shareClass === shareClass);
    if (!state) { res.status(500).json({ error: "Updated certificate counter could not be loaded." }); return; }
    res.json(AdvanceCertificateCounterResponse.parse(state));
  } catch (error) {
    if (error instanceof CertificateError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

export default router;
