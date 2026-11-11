import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { db, signoffsTable, uploadsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import {
  AddSignoffBody, UpdateSignoffBody,
  ListSignoffsResponse, AddSignoffResponse, UpdateSignoffResponse, RequestSignatureUploadBody, RequestSignatureUploadResponse,
} from "@workspace/api-zod";
import { requireAdmin, requireEmployee } from "../middlewares/employee";
import { CertificateError } from "../lib/certificates";
import { ObjectStorageService } from "../lib/objectStorage";
import { validateSignature } from "../lib/signatures";
import sharePricesRouter from "./share-prices";
import auditRouter from "./settings-audit";
import pilotDataRouter from "./pilot-data";
import { signoffChanges, recordSettingsChange } from "../lib/settings-audit";

const router: IRouter = Router();
router.use(sharePricesRouter);
router.use("/settings", requireEmployee, requireAdmin);
router.all(["/settings/users", "/settings/users/:id"], (_req, res) => {
  res.status(410).json({ error: "Pilot access is managed through Replit private publishing; separate app invitations and roles are no longer used." });
});
router.use("/settings", auditRouter);
router.use("/settings", pilotDataRouter);
const presentSignoff = (row: typeof signoffsTable.$inferSelect) => ({
  id: row.id, name: row.name, email: row.email, signaturePath: row.signaturePath,
  emailNotificationsEnabled: row.emailNotificationsEnabled, updatedAt: row.updatedAt.toISOString(),
});
router.get("/settings/signoffs", async (_req, res) => {
  const rows = await db.select().from(signoffsTable).orderBy(asc(signoffsTable.name));
  res.json(ListSignoffsResponse.parse(rows.map(presentSignoff)));
});
router.post("/settings/signoffs", saveSignoff);
router.put("/settings/signoffs/:id", saveSignoff);
async function saveSignoff(req: import("express").Request, res: import("express").Response) {
  const parsed = (req.method === "POST" ? AddSignoffBody : UpdateSignoffBody).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter a name, email and uploaded signature image." }); return; }
  const input = { ...parsed.data, emailNotificationsEnabled: parsed.data.emailNotificationsEnabled ?? true,
    name: parsed.data.name.trim(), email: parsed.data.email.trim().toLowerCase() };
  if (!input.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) { res.status(400).json({ error: "Enter a name and valid email address." }); return; }
  await validateSignature(input.signaturePath);
  const values = { ...input, updatedBy: req.user!.id, updatedAt: new Date() };
  const row = await db.transaction(async tx => {
    const id = req.method === "POST" ? randomUUID() : String(req.params.id);
    const [before] = await tx.select().from(signoffsTable).where(eq(signoffsTable.id, id)).for("update");
    if (req.method !== "POST" && !before) return undefined;
    const changes = signoffChanges(before, input);
    if (!changes.length && before) return before;
    const [saved] = req.method === "POST"
      ? await tx.insert(signoffsTable).values({ id, ...values }).returning()
      : await tx.update(signoffsTable).set(values).where(eq(signoffsTable.id, id)).returning();
    await recordSettingsChange(tx, { action: before ? "Signatory changed" : "Signatory added", targetId: id, changes });
    return saved;
  });
  if (!row) { res.status(404).json({ error: "Signatory not found." }); return; }
  res.status(req.method === "POST" ? 201 : 200).json((req.method === "POST" ? AddSignoffResponse : UpdateSignoffResponse).parse(presentSignoff(row)));
}
router.delete("/settings/signoffs/:id", async (req, res) => {
  const removed = await db.transaction(async tx => {
    const [before] = await tx.select().from(signoffsTable).where(eq(signoffsTable.id, String(req.params.id))).for("update");
    if (!before) return false;
    await tx.delete(signoffsTable).where(eq(signoffsTable.id, before.id));
    await recordSettingsChange(tx, { action: "Signatory removed", targetId: before.id, changes: signoffChanges(before) });
    return true;
  });
  if (!removed) { res.status(404).json({ error: "Signatory not found." }); return; }
  res.status(204).end();
});
router.post("/settings/signature-uploads", async (req, res) => {
  const parsed = RequestSignatureUploadBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose a PNG, JPEG or WebP image up to 2 MB." }); return; }
  const storage = new ObjectStorageService();
  const uploadURL = await storage.getObjectEntityUploadURL();
  const objectPath = storage.normalizeObjectEntityPath(uploadURL);
  await db.insert(uploadsTable).values({
    objectPath, ownerId: req.user!.id, name: parsed.data.name, contentType: parsed.data.contentType, purpose: "signature",
  });
  res.json(RequestSignatureUploadResponse.parse({ uploadURL, objectPath }));
});
router.use("/settings", (error: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (error instanceof CertificateError) { res.status(error.status).json({ error: error.message }); return; }
  const e = error as { status?: number; errors?: { message?: string; longMessage?: string }[]; cause?: { code?: string }; code?: string };
  if (e.cause?.code === "23505" || e.code === "23505") { res.status(409).json({ error: "A signatory with that email already exists." }); return; }
  if (e.status && e.status >= 400 && e.status < 500 && e.errors) {
    res.status(e.status === 429 ? 429 : 400).json({ error: e.errors[0]?.longMessage ?? e.errors[0]?.message ?? "Account service could not complete the request." }); return;
  }
  next(error);
});
export default router;
