import assert from "node:assert/strict";
import { after, test } from "node:test";
import { desc, eq, lte, sql } from "drizzle-orm";
import { db, pool, sharePriceHistoryTable as history } from "@workspace/db";
import { SaveSharePricesBody } from "@workspace/api-zod";
import { pricePolicyError, validPriceDate } from "./share-price-policy";

after(() => pool.end());
test("calendar dates, backdating reasons and exact decimal input boundaries", () => {
  assert.equal(validPriceDate("2024-02-29"), true);
  for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "0000-01-01", "2026-1-1", "invalid"]) {
    assert.equal(validPriceDate(date), false, date);
  }
  assert.match(pricePolicyError("2026-10-27", "  ", "2026-10-28")!, /reason/);
  assert.equal(pricePolicyError("2026-10-27", "Approved valuation", "2026-10-28"), null);
  assert.equal(pricePolicyError("2026-10-28", undefined, "2026-10-28"), null);
  assert.equal(pricePolicyError("2027-01-01", undefined, "2026-10-28"), null);
  for (const common of ["0", "0.000001", "123456789012345678.123456", "001.230000"]) {
    const parsed = SaveSharePricesBody.strict().parse({ common, preferred: "0.00", effectiveDate: "2026-10-28" });
    assert.equal(parsed.common, common);
  }
  assert.equal(SaveSharePricesBody.strict().safeParse({ common: "1", preferred: "1" }).success, false);
  for (const common of ["-1", "1e3", "NaN", "1.1234567", "1234567890123456789", "", "1,000"]) {
    assert.equal(SaveSharePricesBody.strict().safeParse({ common, preferred: "1", effectiveDate: "2026-10-28" }).success, false);
  }
});

test("prices persist losslessly; effective ordering, same-day corrections, and immutable history", async () => {
  // Roll back all test rows. This exercises the real table and its trigger without
  // leaving fake reference prices or needing to disable history protection.
  const rollback = new Error("rollback verification data");
  await assert.rejects(db.transaction(async tx => {
    const baseline = { common: "001.230000", preferred: "123456789012345678.123456", recordedBy: "Verification employee", recordedById: "test-only", reason: "Verification" };
    const [first] = await tx.insert(history).values({ ...baseline, effectiveDate: "0001-01-02" }).returning();
    const [correction] = await tx.insert(history).values({ ...baseline, common: "0.000001", effectiveDate: "0001-01-02" }).returning();
    await tx.insert(history).values({ ...baseline, common: "999", effectiveDate: "9999-12-31" });
    const [persisted] = await tx.select().from(history).where(eq(history.id, first.id));
    assert.equal(persisted.common, "001.230000");
    assert.equal(persisted.preferred, baseline.preferred);
    const before = await tx.select().from(history).where(lte(history.effectiveDate, "0001-01-01"));
    assert.equal(before.length, 0);
    const [effective] = await tx.select().from(history).where(lte(history.effectiveDate, "0001-01-02"))
      .orderBy(desc(history.effectiveDate), desc(history.id)).limit(1);
    assert.equal(effective.id, correction.id);
    assert.equal(effective.common, "0.000001");
    for (const command of [
      sql`UPDATE share_price_history SET common = '2' WHERE id = ${first.id}`,
      sql`DELETE FROM share_price_history WHERE id = ${first.id}`,
      sql`TRUNCATE share_price_history`,
    ]) {
      await tx.execute(sql`SAVEPOINT mutation_check`);
      await assert.rejects(tx.execute(command), error => {
        const cause = (error as { cause?: { message?: string } }).cause;
        return (cause?.message ?? String(error)).includes("Share price history is immutable");
      });
      await tx.execute(sql`ROLLBACK TO SAVEPOINT mutation_check`);
    }
    assert.equal((await tx.select().from(history).where(eq(history.id, first.id))).length, 1);
    throw rollback;
  }), error => error === rollback);
});
