import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { db, shareholdersTable, activityTable, uploadsTable, certificatesTable, type ShareholderRow, type CertificateRow } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { CreateShareholderBody, GetShareholderResponse, GetSummaryResponse, ListActivityResponse, ListShareholdersResponse } from "@workspace/api-zod";
import { employeeRole, requireEmployee } from "../middlewares/employee";
import { encryptSsn, matchesEncryptedSsn } from "../lib/ssn";
import { profileChanges, recordActivity } from "../lib/audit";
import { ObjectStorageService } from "../lib/objectStorage";
import { remainingShares } from "../lib/certificates";

const router: IRouter = Router();
const storage = new ObjectStorageService();
function publicRecord(row: ShareholderRow, certificates: CertificateRow[]) {
  return GetShareholderResponse.parse({
    ...row.data,
    shares: certificates.filter(c => c.shareholderId === row.id && remainingShares(c) > 0)
      .map(c => ({ shareClass: c.shareClass, quantity: remainingShares(c), certificateNumber: c.id })),
    id: row.id, updatedAt: row.updatedAt.toISOString(),
    ssnMasked: row.ssnLast4 ? `•••-••-${row.ssnLast4}` : "",
  });
}
router.get("/session", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const role = await employeeRole(req);
  res.json({ authorized: Boolean(role), role });
});
router.use(["/shareholders", "/summary", "/activity"], requireEmployee);
router.get("/shareholders", async (_req, res) => {
  const rows = await db.select().from(shareholdersTable).orderBy(desc(shareholdersTable.updatedAt));
  const certificates = await db.select().from(certificatesTable);
  res.json(ListShareholdersResponse.parse(rows.map(r => publicRecord(r, certificates))));
});
router.get("/shareholders/:id", async (req, res) => {
  const [row] = await db.select().from(shareholdersTable).where(eq(shareholdersTable.id, String(req.params.id)));
  if (!row) { res.status(404).json({ error: "Shareholder not found." }); return; }
  const certificates = await db.select().from(certificatesTable).where(eq(certificatesTable.shareholderId, row.id));
  res.json(publicRecord(row, certificates));
});
router.post("/shareholders", saveRecord);
router.put("/shareholders/:id", saveRecord);

async function saveRecord(req: import("express").Request, res: import("express").Response): Promise<void> {
  if (req.body && Object.hasOwn(req.body, "shares")) {
    res.status(400).json({ error: "Share holdings are managed through certificates, not the shareholder form." }); return;
  }
  const parsed = CreateShareholderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Check the required fields and share quantities." }); return; }
  const { ssn, ...input } = parsed.data;
  const name = input.name.trim();
  if (!name || (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))) {
    res.status(400).json({ error: "Enter a name and a valid email address." }); return;
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const date of [input.dateOfBirth, input.dateOfPassing]) {
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today)) {
      res.status(400).json({ error: "Dates must be valid and not in the future." }); return;
    }
  }
  if (input.dateOfBirth && input.dateOfPassing && input.dateOfPassing < input.dateOfBirth) {
    res.status(400).json({ error: "Date of passing cannot precede date of birth." }); return;
  }
  const normalizedSsn = ssn?.replace(/-/g, "").trim();
  if (normalizedSsn && !/^\d{9}$/.test(normalizedSsn)) {
    res.status(400).json({ error: "SSN must contain nine digits." }); return;
  }
  const paths = [...(input.documents ?? []).map(d => d.objectPath), ...(input.picturePath ? [input.picturePath] : [])];
  for (const path of paths) {
    const [upload] = await db.select().from(uploadsTable).where(eq(uploadsTable.objectPath, path));
    if (!upload) { res.status(400).json({ error: "An attachment is not a registered upload." }); return; }
    if (upload.purpose !== "profile") { res.status(400).json({ error: "Signature images cannot be attached to shareholder records." }); return; }
    try {
      const file = await storage.getObjectEntityFile(path);
      const [metadata] = await file.getMetadata();
      if (Number(metadata.size) > 10485760 || metadata.contentType !== upload.contentType) {
        res.status(400).json({ error: "An attachment has an invalid type or exceeds 10 MB." }); return;
      }
      if (path === input.picturePath && !["image/jpeg", "image/png", "image/webp"].includes(upload.contentType)) {
        res.status(400).json({ error: "The picture must be JPEG, PNG or WebP." }); return;
      }
    } catch {
      res.status(400).json({ error: "An attachment has not finished uploading." }); return;
    }
  }
  const data = {
    email: "", dateOfBirth: "", dateOfPassing: "", address: "", phone: "",
    familyLine: "", generationNumber: "", financialNotes: "", picturePath: "", documents: [],
    ...input,
  };
  data.name = name;
  const id = req.method === "POST" ? randomUUID() : String(req.params.id);
  const row = await db.transaction(async (tx) => {
    const [previous] = req.method === "POST" ? [] : await tx.select().from(shareholdersTable).where(eq(shareholdersTable.id, id)).for("update");
    if (req.method !== "POST" && !previous) return undefined;
    const ssnChanged = Boolean(normalizedSsn && (!previous?.ssnEncrypted || !matchesEncryptedSsn(previous.ssnEncrypted, normalizedSsn)));
    const changes = profileChanges(previous?.data, data, ssnChanged, Boolean(previous?.ssnEncrypted));
    if (previous && changes.length === 0) return previous;
    const secured = ssnChanged ? { ssnEncrypted: encryptSsn(normalizedSsn!), ssnLast4: normalizedSsn!.slice(-4) } : {};
    const values = { data, ...secured, updatedAt: new Date() };
    const [saved] = req.method === "POST"
      ? await tx.insert(shareholdersTable).values({ id, ...values }).returning()
      : await tx.update(shareholdersTable).set(values).where(eq(shareholdersTable.id, id)).returning();
    if (saved) await recordActivity(tx, {
      shareholderId: id, name, actor: req.user!.id, changes,
      action: req.method === "POST" ? "Shareholder created" : "Record updated",
    });
    return saved;
  });
  if (!row) { res.status(404).json({ error: "Shareholder not found." }); return; }
  const certificates = await db.select().from(certificatesTable).where(eq(certificatesTable.shareholderId, row.id));
  res.status(req.method === "POST" ? 201 : 200).json(publicRecord(row, certificates));
}
router.get("/summary", async (_req, res) => {
  const certificates = await db.select().from(certificatesTable);
  const rows = (await db.select().from(shareholdersTable)).map(r => publicRecord(r, certificates));
  res.json(GetSummaryResponse.parse({
    totalShareholders: rows.length,
    totalShares: rows.reduce((sum, row) => sum + row.shares.reduce((s, h) => s + h.quantity, 0), 0),
    familyLines: new Set(rows.map(r => r.familyLine).filter(Boolean)).size,
    documents: rows.reduce((sum, row) => sum + row.documents.length, 0),
  }));
});
router.get("/activity", async (_req, res) => {
  const rows = await db.select().from(activityTable).orderBy(desc(activityTable.createdAt)).limit(20);
  res.json(ListActivityResponse.parse(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() }))));
});
export default router;
