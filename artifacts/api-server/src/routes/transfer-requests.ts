import { Router, type IRouter } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { db, transferRequestsTable } from "@workspace/db";
import {
  ListTransferRequestsQueryParams, ListTransferRequestsResponse,
  GetTransferRequestParams, GetTransferRequestResponse,
  DecideTransferRequestParams, DecideTransferRequestBody, DecideTransferRequestResponse,
} from "@workspace/api-zod";
import { employeeIdentity, requireEmployee } from "../middlewares/employee";
import { configuredSigners } from "../lib/approval-policy";
import { CertificateError } from "../lib/certificates";
import { decideRequest, presentRequest } from "../lib/transfer-requests";
import { captureCertificateTemplate, retainCompletedCertificate } from "../lib/certificate-documents";
import { dispatchRequesterResultEmail, retryFailedSignoffEmails } from "../lib/signoff-notifications";

const router: IRouter = Router();
router.use("/transfer-requests", requireEmployee);
router.get("/transfer-requests", async (req, res) => {
  const parsed = ListTransferRequestsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid shareholder filter." }); return; }
  const id = parsed.data.shareholderId;
  const rows = await db.select().from(transferRequestsTable)
    .where(and(eq(transferRequestsTable.kind, "Transfer"), id ? or(eq(transferRequestsTable.originatorId, id), eq(transferRequestsTable.recipientId, id)) : undefined))
    .orderBy(desc(transferRequestsTable.createdAt));
  const signers = await configuredSigners(db), identity = await employeeIdentity(req);
  res.json(ListTransferRequestsResponse.parse(rows.map(r => presentRequest(r, signers, identity))));
});
router.get("/transfer-requests/:requestId", async (req, res) => {
  const params = GetTransferRequestParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid request ID." }); return; }
  const [row] = await db.select().from(transferRequestsTable).where(eq(transferRequestsTable.id, params.data.requestId));
  if (!row) { res.status(404).json({ error: "Transfer request not found." }); return; }
  res.json(GetTransferRequestResponse.parse(presentRequest(row, await configuredSigners(db), await employeeIdentity(req))));
});
router.post("/transfer-requests/:requestId/email-notifications/retry", async (req, res) => {
  const params = GetTransferRequestParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid request ID." }); return; }
  try {
    res.json(await retryFailedSignoffEmails(params.data.requestId));
  } catch (error) {
    if (error instanceof CertificateError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});
router.post("/transfer-requests/:requestId", async (req, res) => {
  const params = DecideTransferRequestParams.safeParse(req.params);
  const body = DecideTransferRequestBody.strict().safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Choose approve or reject." }); return; }
  try {
    const identity = await employeeIdentity(req);
    const result = await db.transaction(async tx => {
      const [pending] = await tx.select().from(transferRequestsTable)
        .where(eq(transferRequestsTable.id, params.data.requestId)).for("update");
      // Existing pending requests also receive a versioned template before the next approval.
      if (pending?.status === "Pending" && body.data.decision === "approve") await captureCertificateTemplate(tx, pending);
      const result = await decideRequest(tx, params.data.requestId, identity.id, identity.emails, body.data.decision);
      await retainCompletedCertificate(tx, result);
      return result;
    });
    if (result.status === "Completed" || result.status === "Rejected") {
      try {
        await dispatchRequesterResultEmail(result.id);
      } catch {
        req.log.warn({ requestId: result.id }, "Requester outcome notification could not be dispatched.");
      }
    }
    res.json(DecideTransferRequestResponse.parse(presentRequest(result, [], identity)));
  } catch (error) {
    if (error instanceof CertificateError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});
export default router;
