import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { db, pool, companySettingsTable, signoffsTable } from "@workspace/db";
import { AddAccessUserBody, SaveSharePricesBody, AddSignoffBody, RequestSignatureUploadBody } from "@workspace/api-zod";
import { assertRemovable, presentInvitation, presentUser } from "./access-users";
import { CertificateError } from "./certificates";
import { signatureImageMatches } from "./signatures";

const user = (id: string, role: string | null = "admin") => ({
  id, firstName: "Verification", lastName: id, publicMetadata: { role }, banned: false,
  primaryEmailAddressId: "email", emailAddresses: [{ id: "email", emailAddress: `${id}@example.com` }],
  createdAt: 1, lastSignInAt: null,
}) as unknown as Parameters<typeof presentUser>[0];
test("administrator removal protections and user directory normalization", () => {
  const owner = user("owner"), other = user("other");
  assert.throws(() => assertRemovable("owner", owner, [owner, other]), e => e instanceof CertificateError && e.status === 409);
  assert.throws(() => assertRemovable("other", owner, [owner, user("other", null)]), e => e instanceof CertificateError && e.status === 409);
  assert.doesNotThrow(() => assertRemovable("other", owner, [owner, user("other", "hr")]));
  assert.equal(presentUser(user("legacy", "hr"), "owner").role, "admin");
  assert.doesNotThrow(() => assertRemovable("owner", other, [owner, other]));
  assert.equal(presentUser(owner, "owner").isCurrent, true);
  assert.equal(presentUser(other, "owner").status, "Active");
  assert.equal(presentUser(user("former", null), "owner").status, "No access");
  const invite = presentInvitation({ id: "inv_test", emailAddress: "invite@example.com", publicMetadata: null, createdAt: 1 } as unknown as Parameters<typeof presentInvitation>[0]);
  assert.equal(invite.role, null);
  assert.equal(invite.status, "Invited");
});
test("price, access and signature input boundaries", () => {
  assert.ok(SaveSharePricesBody.strict().safeParse({ common: "0", preferred: "123456789012345678.123456", effectiveDate: "2026-10-28" }).success);
  for (const price of ["-1", "1.1234567", "1234567890123456789", "NaN", "1e6", "", "Infinity"]) {
    assert.equal(SaveSharePricesBody.strict().safeParse({ common: price, preferred: "1", effectiveDate: "2026-10-28" }).success, false);
  }
  assert.equal(AddAccessUserBody.strict().safeParse({ email: "v@example.com", role: "owner" }).success, false);
  assert.equal(AddAccessUserBody.strict().safeParse({ email: "v@example.com", role: "admin", isCurrent: true }).success, false);
  assert.equal(AddSignoffBody.strict().safeParse({ name: "Signer", email: "v@example.com" }).success, false);
  assert.ok(RequestSignatureUploadBody.strict().safeParse({ name: "sig.png", size: 1024, contentType: "image/png" }).success);
  assert.equal(RequestSignatureUploadBody.strict().safeParse({ name: "sig.svg", size: 1024, contentType: "image/svg+xml" }).success, false);
  assert.equal(RequestSignatureUploadBody.strict().safeParse({ name: "sig.png", size: 2097153, contentType: "image/png" }).success, false);
  assert.ok(signatureImageMatches(Buffer.from([137,80,78,71,13,10,26,10]), "image/png"));
  assert.ok(signatureImageMatches(Buffer.from([255,216,255]), "image/jpeg"));
  assert.ok(signatureImageMatches(Buffer.from("RIFF1234WEBP"), "image/webp"));
  assert.ok(!signatureImageMatches(Buffer.from("<script>not an image</script>"), "image/png"));
});
test("price precision and signatory CRUD persist without affecting certificates", async () => {
  const schema = `settings_checks_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  try {
    for (const table of ["company_settings", "signoffs"]) await pool.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    await db.transaction(async tx => {
      await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}", public`));
      await tx.insert(companySettingsTable).values({ id: "company", commonPrice: "0", preferredPrice: "123456789012345678.123456", updatedBy: "test-admin" });
      const [prices] = await tx.select().from(companySettingsTable);
      assert.equal(prices.commonPrice, "0.000000");
      assert.equal(prices.preferredPrice, "123456789012345678.123456");
      await tx.insert(signoffsTable).values({ id: "signer", name: "Verification", email: "signer@example.com", signaturePath: "/objects/uploads/private-image", updatedBy: "test-admin" });
      await tx.update(signoffsTable).set({ name: "Renamed", signaturePath: "/objects/uploads/replacement" }).where(eq(signoffsTable.id, "signer"));
      const [signer] = await tx.select().from(signoffsTable);
      assert.equal(signer.emailNotificationsEnabled, true, "existing and newly created signers receive approval email by default");
      assert.equal(signer.name, "Renamed");
      assert.equal(signer.signaturePath, "/objects/uploads/replacement");
      await tx.delete(signoffsTable).where(eq(signoffsTable.id, "signer"));
      assert.equal((await tx.select().from(signoffsTable)).length, 0);
    });
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
