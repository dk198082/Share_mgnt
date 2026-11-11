import { Router, type IRouter } from "express";
import { db, settingsAuditTable } from "@workspace/db";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { ListSettingsAuditQueryParams, ListSettingsAuditResponse } from "@workspace/api-zod";
import { CertificateError, type Transaction } from "../lib/certificates";

const router: IRouter = Router();
export async function loadSettingsAudit(cursor?: string, reader: Pick<Transaction, "select"> = db) {
  const [anchor] = cursor ? await reader.select().from(settingsAuditTable).where(eq(settingsAuditTable.id, cursor)) : [];
  if (cursor && !anchor) throw new CertificateError(400, "Audit cursor not found.");
  const rows = await reader.select().from(settingsAuditTable).where(anchor ? or(
    lt(settingsAuditTable.createdAt, anchor.createdAt),
    and(eq(settingsAuditTable.createdAt, anchor.createdAt), lt(settingsAuditTable.id, anchor.id)),
  ) : undefined).orderBy(desc(settingsAuditTable.createdAt), desc(settingsAuditTable.id)).limit(51);
  const page = rows.slice(0, 50);
  return ListSettingsAuditResponse.parse({
    entries: page.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null })),
    nextCursor: rows.length > 50 ? page[page.length - 1].id : null,
  });
}
// Mounted only behind the settings employee/admin middleware.
router.get("/audit", async (req, res): Promise<void> => {
  const parsed = ListSettingsAuditQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid audit cursor." }); return; }
  res.json(await loadSettingsAudit(parsed.data.before));
});
export default router;
