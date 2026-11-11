import { Router, type IRouter } from "express";
import { db, sharePriceHistoryTable as history, type SharePriceRecord } from "@workspace/db";
import { desc, eq, isNull, lte, sql } from "drizzle-orm";
import { GetSharePricesResponse, SaveSharePricesBody, LookupSharePricesQueryParams, LookupSharePricesResponse, ListSharePriceHistoryResponse } from "@workspace/api-zod";
import { requireAdmin, requireEmployee } from "../middlewares/employee";
import { auditContext, change } from "../lib/audit";
import { recordSettingsChange } from "../lib/settings-audit";
import { pricePolicyError, priceToday, validPriceDate } from "../lib/share-price-policy";

const router: IRouter = Router();
const present = (row?: SharePriceRecord) => ({
  common: row?.common ?? null, preferred: row?.preferred ?? null,
  updatedAt: row?.recordedAt.toISOString() ?? null,
  effectiveDate: row?.effectiveDate ?? null, currency: "USD" as const,
});
async function lookup(date: string, includeLegacy = false) {
  const [row] = await db.select().from(history).where(lte(history.effectiveDate, date))
    .orderBy(desc(history.effectiveDate), desc(history.id)).limit(1);
  if (row || !includeLegacy) return present(row);
  const [legacy] = await db.select().from(history).where(isNull(history.effectiveDate)).limit(1);
  return present(legacy);
}
router.get("/share-prices/current", requireEmployee, async (_req, res) => {
  res.json(GetSharePricesResponse.parse(await lookup(priceToday(), true)));
});
router.get("/share-prices", requireEmployee, async (req, res) => {
  const parsed = LookupSharePricesQueryParams.safeParse(req.query);
  if (!parsed.success || !validPriceDate(parsed.data.date)) {
    res.status(400).json({ error: "Enter a valid lookup date (YYYY-MM-DD)." }); return;
  }
  res.json(LookupSharePricesResponse.parse(await lookup(parsed.data.date)));
});
router.get("/share-prices/history", requireEmployee, async (_req, res) => {
  const rows = await db.select().from(history).orderBy(desc(history.id));
  res.json(ListSharePriceHistoryResponse.parse(rows.map(row => ({
    ...row, recordedAt: row.recordedAt.toISOString(), legacy: row.effectiveDate === null,
  }))));
});
router.get("/settings/share-prices", requireEmployee, requireAdmin, async (_req, res) => {
  res.json(GetSharePricesResponse.parse(await lookup(priceToday(), true)));
});
router.put("/settings/share-prices", requireEmployee, requireAdmin, async (req, res) => {
  const parsed = SaveSharePricesBody.strict().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter prices with up to 18 whole digits and six decimals, an effective date, and a reason of at most 2000 characters." }); return;
  }
  const error = pricePolicyError(parsed.data.effectiveDate, parsed.data.reason);
  if (error) { res.status(400).json({ error }); return; }
  const input = parsed.data;
  await db.transaction(async tx => {
    // Serialize appends: same-date corrections are ordered by the generated ID.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7936051)`);
    const [last] = await tx.select().from(history).where(eq(history.effectiveDate, input.effectiveDate))
      .orderBy(desc(history.id)).limit(1);
    if (last?.common === input.common && last?.preferred === input.preferred) return;
    const [saved] = await tx.insert(history).values({
      common: input.common, preferred: input.preferred, effectiveDate: input.effectiveDate,
      reason: input.reason?.trim() || null,
      recordedBy: auditContext.getStore()?.name ?? req.user!.id,
      recordedById: req.user!.id,
    }).returning();
    // Dated price history and the administrative audit entry commit together.
    // "Before" is the prior version for this effective date, not today's price.
    const changes = [
      change("Common price", last?.common ?? null, input.common),
      change("Preferred price", last?.preferred ?? null, input.preferred),
      change("Effective date", last?.effectiveDate ?? null, input.effectiveDate),
      change("Reason", last?.reason ?? null, input.reason?.trim() || null),
    ].filter(c => c.before !== c.after);
    await recordSettingsChange(tx, { action: "Share prices changed", targetId: `share-price-history:${saved.id}`, changes });
  });
  res.json(GetSharePricesResponse.parse(await lookup(priceToday(), true)));
});
export default router;
