import { Router, type IRouter } from "express";
import { db, certificatesTable, shareholdersTable, shareTransfersTable } from "@workspace/db";
import { desc, eq, or } from "drizzle-orm";
import { IssueCertificateBody, IssueCertificateParams, IssueCertificateResponse, ListCertificatesParams, ListCertificatesResponse, TransferSharesBody, TransferSharesParams, TransferSharesResponse } from "@workspace/api-zod";
import { employeeIdentity, requireEmployee } from "../middlewares/employee";
import { CertificateError, outstandingTotal, presentCertificate } from "../lib/certificates";
import { presentTransfer } from "../lib/transfers";
import { validateTransferDocuments } from "../lib/transfer-attachments";
import { presentRequest, requestTransfer } from "../lib/transfer-requests";
import { requestIssuance } from "../lib/issuance-requests";
import { dispatchSignoffEmails } from "../lib/signoff-notifications";
import { getNotificationOrigin } from "../lib/notification-origin";
import { captureCertificateTemplate } from "../lib/certificate-documents";

const router: IRouter = Router();
router.use("/shareholders/:id/certificates", requireEmployee);

router.get("/shareholders/:id/certificates", async (req, res) => {
  const params = ListCertificatesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid shareholder ID." }); return; }
  const [owner] = await db.select({ id: shareholdersTable.id }).from(shareholdersTable).where(eq(shareholdersTable.id, params.data.id));
  if (!owner) { res.status(404).json({ error: "Shareholder not found." }); return; }
  const all = await db.select().from(certificatesTable);
  const companyFullyDiluted = outstandingTotal(all);
  const rows = all.filter(c => c.shareholderId === params.data.id);
  const transfers = await db.select().from(shareTransfersTable)
    .where(or(eq(shareTransfersTable.originatorId, params.data.id), eq(shareTransfersTable.recipientId, params.data.id)))
    .orderBy(desc(shareTransfersTable.transferDate), desc(shareTransfersTable.createdAt));
  res.json(ListCertificatesResponse.parse({
    certificates: rows.map(c => presentCertificate(c, companyFullyDiluted)),
    transfers: transfers.map(presentTransfer),
    companyFullyDiluted, totalShares: outstandingTotal(rows),
    calculationNote: "Current basis: each remaining Common or Preferred share counts as one share. Partial transfers reduce the original certificate's balance; fully transferred and cancelled certificates contribute zero. Percentage uses all remaining certificate shares across the company. Transfers conserve that company total. Options, warrants and conversion ratios are not yet modeled.",
  }));
});

router.post("/shareholders/:id/certificates", async (req, res) => {
  const params = IssueCertificateParams.safeParse(req.params);
  const parsed = IssueCertificateBody.strict().safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Choose Common or Preferred, a positive whole share quantity, a valid issue date, and a vesting schedule." }); return;
  }
  const input = { ...parsed.data, vestingSchedule: parsed.data.vestingSchedule.trim() };
  const date = new Date(input.issueDate);
  if (!input.vestingSchedule || Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.issueDate ||
      input.issueDate > new Date().toISOString().slice(0, 10)) {
    res.status(400).json({ error: "Enter a valid issue date no later than today and a vesting schedule." }); return;
  }
  const origin = getNotificationOrigin(req);
  if (!origin) { res.status(400).json({ error: "A secure app origin is required to notify the configured signers." }); return; }
  try {
    const identity = await employeeIdentity(req);
    if (!identity.notificationEmail) { res.status(400).json({ error: "A verified email address is required to receive the request outcome." }); return; }
    const request = await db.transaction(async tx => {
      const request = await requestIssuance(tx, params.data.id, input, identity.id, origin, identity.notificationEmail!);
      await captureCertificateTemplate(tx, request);
      return request;
    });
    const emailNotificationSummary = await dispatchSignoffEmails(request.id);
    res.status(201).json(IssueCertificateResponse.parse({ ...presentRequest(request), emailNotificationSummary }));
  } catch (error) {
    if (error instanceof CertificateError) {
      res.status(error.status).json({ error: error.message }); return;
    }
    throw error;
  }
});
router.post("/shareholders/:id/certificates/:certificateId/transfers", async (req, res) => {
  const params = TransferSharesParams.safeParse(req.params);
  const parsed = TransferSharesBody.strict().safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Enter a recipient, a positive whole share quantity, a valid transfer date, and an optional nonnegative price (up to six decimal places)." }); return;
  }
  const origin = getNotificationOrigin(req);
  if (!origin) { res.status(400).json({ error: "A secure app origin is required to notify the configured signers." }); return; }
  try {
    const identity = await employeeIdentity(req);
    if (!identity.notificationEmail) { res.status(400).json({ error: "A verified email address is required to receive the request outcome." }); return; }
    await validateTransferDocuments(parsed.data.attachments ?? []);
    const result = await db.transaction(async tx => {
      const result = await requestTransfer(tx, params.data.id, params.data.certificateId, parsed.data, identity.id, origin, identity.notificationEmail!);
      await captureCertificateTemplate(tx, result);
      return result;
    });
    const emailNotificationSummary = await dispatchSignoffEmails(result.id);
    res.status(201).json(TransferSharesResponse.parse({ ...presentRequest(result), emailNotificationSummary }));
  } catch (error) {
    if (error instanceof CertificateError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});
export default router;
