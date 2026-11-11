import express, { Router, type IRouter } from "express";
import { db, uploadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { RequestUploadUrlBody, RequestUploadUrlResponse } from "@workspace/api-zod";
import { employeeRole, requireEmployee } from "../middlewares/employee";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const types = ["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"];
router.use("/storage", requireEmployee);
router.post("/storage/uploads/request-url", async (req, res) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success || !types.includes(parsed.data.contentType)) {
    res.status(400).json({ error: "Upload a PDF, JPEG, PNG, WebP or text file, up to 10 MB." }); return;
  }
  const uploadURL = await storage.getObjectEntityUploadURL();
  const objectPath = storage.normalizeObjectEntityPath(uploadURL);
  await db.insert(uploadsTable).values({ objectPath, ownerId: req.user!.id, name: parsed.data.name, contentType: parsed.data.contentType });
  res.json(RequestUploadUrlResponse.parse({ uploadURL, objectPath }));
});
router.put("/storage/uploads/:id/content", express.raw({ type: () => true, limit: "10mb" }), async (req, res) => {
  const objectPath = `/objects/uploads/${req.params.id}`;
  const [upload] = await db.select().from(uploadsTable).where(eq(uploadsTable.objectPath, objectPath));
  if (!upload || upload.ownerId !== req.user!.id) {
    res.status(404).json({ error: "Upload not found." }); return;
  }
  const contentType = req.get("content-type")?.split(";")[0].trim();
  if (!Buffer.isBuffer(req.body) || req.body.length < 1 || req.body.length > 10485760 ||
      contentType !== upload.contentType) {
    res.status(400).json({ error: "Upload bytes do not match the registered file type or size limit." }); return;
  }
  await storage.putPrivateObject(objectPath, req.body, upload.contentType);
  res.status(204).end();
});
router.get("/storage/objects/uploads/:id", async (req, res) => {
  const path = `/objects/uploads/${req.params.id}`;
  const [upload] = await db.select().from(uploadsTable).where(eq(uploadsTable.objectPath, path));
  if (!upload) { res.status(404).json({ error: "File not found." }); return; }
  if (upload.purpose === "signature" && !await employeeRole(req)) {
    res.status(403).json({ error: "Administrator access required for signature images." }); return;
  }
  try {
    const file = await storage.getObjectEntityFile(path);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) > 10485760 || metadata.contentType !== upload.contentType) {
      res.status(400).json({ error: "Invalid uploaded file." }); return;
    }
    res.set("Content-Type", upload.contentType);
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Security-Policy", "sandbox");
    res.set("Content-Disposition", `${upload.contentType.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(upload.name)}`);
    file.createReadStream().on("error", () => res.destroy()).pipe(res);
  } catch { res.status(404).json({ error: "File not found." }); }
});
export default router;
