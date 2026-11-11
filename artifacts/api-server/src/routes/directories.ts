import { Router, type IRouter } from "express";
import { db, certificatesTable, shareholdersTable, shareTransfersTable, transferRequestsTable } from "@workspace/db";
import { desc, eq, or } from "drizzle-orm";
import {
  ListTransfersResponse, GetTransferResponse, AttachTransferFilesBody, AttachTransferFilesResponse,
  AttachRequestFilesBody, AttachRequestFilesResponse, ListMySignoffRequestsResponse, ListAllCertificatesResponse,
  ListSignoffHistoryQueryParams, ListSignoffHistoryResponse,
} from "@workspace/api-zod";
import { employeeIdentity, employeeRole, requireEmployee } from "../middlewares/employee";
import { configuredSigners } from "../lib/approval-policy";
import { CertificateError } from "../lib/certificates";
import { presentTransfer } from "../lib/transfers";
import { presentRequest } from "../lib/transfer-requests";
import { certificateDirectory, needsSignoff } from "../lib/directories";
import { appendRequestDocuments, appendTransferDocuments, validateTransferDocuments } from "../lib/transfer-attachments";

const router: IRouter = Router();
router.use(["/transfers", "/certificates", "/sign-off-requests", "/transfer-requests", "/sign-off-history"], requireEmployee);
router.get("/transfers", async (_req, res) => {
  const rows = await db.select().from(shareTransfersTable).orderBy(desc(shareTransfersTable.transferDate), desc(shareTransfersTable.createdAt));
  res.json(ListTransfersResponse.parse(rows.map(presentTransfer)));
});
router.get("/transfers/:id", async (req, res) => {
  const [row] = await db.select().from(shareTransfersTable).where(eq(shareTransfersTable.id, String(req.params.id)));
  if (!row) { res.status(404).json({ error: "Transfer not found." }); return; }
  res.json(GetTransferResponse.parse(presentTransfer(row)));
});
router.post("/transfers/:id/attachments", async (req, res) => {
  const body = AttachTransferFilesBody.strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Choose one to 20 files, up to 10 MB each." }); return; }
  await validateTransferDocuments(body.data.attachments);
  const row = await db.transaction(tx => appendTransferDocuments(tx, String(req.params.id), body.data.attachments, req.user!.id));
  res.json(AttachTransferFilesResponse.parse(presentTransfer(row)));
});
router.post("/transfer-requests/:requestId/attachments", async (req, res) => {
  const body = AttachRequestFilesBody.strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Choose one to 20 files, up to 10 MB each." }); return; }
  await validateTransferDocuments(body.data.attachments);
  const role = await employeeRole(req);
  const row = await db.transaction(tx => appendRequestDocuments(tx, String(req.params.requestId), body.data.attachments, req.user!.id, role));
  res.json(AttachRequestFilesResponse.parse(presentRequest(row)));
});
router.get("/sign-off-requests", async (req, res) => {
  const identity = await employeeIdentity(req), signers = await configuredSigners(db);
  const rows = await db.select().from(transferRequestsTable).where(eq(transferRequestsTable.status, "Pending")).orderBy(transferRequestsTable.createdAt);
  res.json(ListMySignoffRequestsResponse.parse(rows.filter(r => needsSignoff(r, identity.id, identity.emails, signers)).map(r => presentRequest(r, signers, identity))));
});
router.get("/sign-off-history", async (req, res) => {
  const query = ListSignoffHistoryQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Invalid shareholder filter." }); return; }
  const id = query.data.shareholderId;
  const rows = await db.select().from(transferRequestsTable)
    .where(id ? or(eq(transferRequestsTable.originatorId, id), eq(transferRequestsTable.recipientId, id)) : undefined)
    .orderBy(desc(transferRequestsTable.createdAt));
  const signers = await configuredSigners(db), identity = await employeeIdentity(req);
  res.json(ListSignoffHistoryResponse.parse(rows.map(r => presentRequest(r, signers, identity))));
});
router.get("/certificates", async (_req, res) => {
  const rows = await db.transaction(async tx => {
    const certificates = await tx.select().from(certificatesTable).orderBy(desc(certificatesTable.createdAt));
    const shareholders = await tx.select().from(shareholdersTable);
    const transfers = await tx.select().from(shareTransfersTable);
    return certificateDirectory(certificates, shareholders, transfers);
  }, { isolationLevel: "repeatable read" });
  res.json(ListAllCertificatesResponse.parse(rows));
});
router.use((error: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (error instanceof CertificateError) { res.status(error.status).json({ error: error.message }); return; }
  next(error);
});
export default router;
