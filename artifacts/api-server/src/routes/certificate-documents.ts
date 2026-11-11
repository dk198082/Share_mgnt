import { Router, type IRouter } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { db, certificateTemplatesTable, certificateDocumentsTable, uploadsTable } from "@workspace/db";
import { requireAdmin, requireEmployee } from "../middlewares/employee";
import { CertificateError } from "../lib/certificates";
import { installCertificateTemplate, readPrivateBytes } from "../lib/certificate-documents";
import { SaveCertificateTemplateBody, ListCertificatePdfsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();
router.use("/settings/certificate-templates", requireEmployee, requireAdmin);
router.get("/settings/certificate-templates", requireAdmin, async (_req, res) => {
  res.json((await db.select().from(certificateTemplatesTable).orderBy(desc(certificateTemplatesTable.createdAt)))
    .map(({ objectPath: _path, ...row }) => ({ ...row, createdAt: row.createdAt.toISOString() })));
});
router.post("/settings/certificate-templates", requireAdmin, async (req, res) => {
  const input = SaveCertificateTemplateBody.strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Choose a share class and upload a blank fillable PDF." }); return; }
  const [upload] = await db.select().from(uploadsTable).where(eq(uploadsTable.objectPath, input.data.objectPath));
  if (!upload || upload.ownerId !== req.user!.id || upload.contentType !== "application/pdf") {
    res.status(400).json({ error: "Upload your own PDF file before saving the template." }); return;
  }
  try {
    const row = await installCertificateTemplate(await readPrivateBytes(input.data.objectPath), input.data.shareClass, input.data.name, req.user!.id);
    const { objectPath: _path, ...result } = row;
    res.status(201).json({ ...result, createdAt: row.createdAt.toISOString() });
  } catch (error) {
    res.status(error instanceof CertificateError ? error.status : 400).json({ error: error instanceof Error ? error.message : "The template could not be saved." });
  }
});
router.get("/settings/certificate-templates/:id/pdf", requireAdmin, async (req, res) => {
  const [template] = await db.select().from(certificateTemplatesTable).where(eq(certificateTemplatesTable.id, String(req.params.id)));
  if (!template) { res.status(404).json({ error: "Template not found." }); return; }
  const bytes = await readPrivateBytes(template.objectPath);
  res.set({ "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="${template.shareClass}-blank.pdf"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" }).send(bytes);
});
router.get("/certificate-pdfs", requireEmployee, async (req, res) => {
  const filters = ListCertificatePdfsQueryParams.strict().safeParse(req.query);
  if (!filters.success) { res.status(400).json({ error: "Invalid PDF filter." }); return; }
  const q = filters.data;
  const rows = await db.select().from(certificateDocumentsTable).where(and(
    q.shareholderId ? or(eq(certificateDocumentsTable.shareholderId, q.shareholderId), eq(certificateDocumentsTable.originatorId, q.shareholderId)) : undefined,
    q.certificateId ? eq(certificateDocumentsTable.certificateId, q.certificateId) : undefined,
    q.transferId ? eq(certificateDocumentsTable.transferId, q.transferId) : undefined,
    q.requestId ? eq(certificateDocumentsTable.requestId, q.requestId) : undefined,
  )).orderBy(desc(certificateDocumentsTable.createdAt));
  res.json(rows.map(({ objectPath: _path, ...row }) => ({ ...row, createdAt: row.createdAt.toISOString() })));
});
router.get("/certificate-pdfs/:id", requireEmployee, async (req, res) => {
  const [row] = await db.select().from(certificateDocumentsTable).where(eq(certificateDocumentsTable.id, String(req.params.id)));
  if (!row) { res.status(404).json({ error: "Certificate PDF not found." }); return; }
  const bytes = await readPrivateBytes(row.objectPath);
  res.set({ "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="${row.certificateId}.pdf"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" }).send(bytes);
});
export default router;
