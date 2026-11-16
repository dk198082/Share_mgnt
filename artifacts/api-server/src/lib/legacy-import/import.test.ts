import assert from "node:assert/strict";
import { beforeEach, after, test } from "node:test";
import express from "express";
import request from "supertest";
import { db, pool, activityTable, shareholdersTable, certificatesTable, certificateCountersTable, shareTransfersTable, legacyImportRunsTable, settingsAuditTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { convert, calendarDate, quantity } from "./convert";
import { readWorkbooks, validateArchive } from "./workbooks";
import { fixtureFiles, syntheticRows } from "./fixtures.test-support";
import { commitImport, stageImport, importAvailability } from "./service";
import router from "../../routes/legacy-import";

if (process.env.LEGACY_IMPORT_TEST_CLUSTER !== "owned-disposable") throw new Error("Run through the private-cluster runner; never target an app database.");
const actor = { id: "synthetic-operator", name: "Synthetic import operator" };
beforeEach(async () => {
  await db.delete(shareTransfersTable); await db.delete(certificatesTable); await db.delete(certificateCountersTable);
  await db.delete(activityTable); await db.delete(shareholdersTable); await db.delete(legacyImportRunsTable); await db.delete(settingsAuditTable);
});
after(async () => { await pool.end(); });
const assess = async (rows = syntheticRows(), history = false) => convert((await readWorkbooks(await fixtureFiles(rows, history))).sheets);
const errors = (result: Awaited<ReturnType<typeof assess>>) => result.issues.filter(i => i.severity === "error");
const code = (result: Awaited<ReturnType<typeof assess>>, key: string) => result.issues.some(i => i.code === key);

test("converts two classes exactly, preserves old dates and leaves optional fields blank", async () => {
  const result = await assess();
  assert.deepEqual(errors(result), []);
  assert.equal(result.counts.commonShares, 10.25); assert.equal(result.counts.preferredShares, 0.01);
  assert.equal(result.plan.certificates[0].issueDate, "1940-01-01");
  assert.equal(result.plan.certificates[0].status, "Partially Transferred");
  assert.equal(result.plan.people[0].data.familyLine, "Unclassified note");
  assert.match(String(result.plan.people[0].data.name), /^SAMPLE/);
  assert.equal(result.plan.transfers.length, 0); assert.ok(code(result, "NO_TRANSFER_EVENTS"));
});
test("approved Comments mapping populates family line exactly and retains notes", async () => {
  const rows = syntheticRows();
  rows.people[0].Comments = "Synthetic Line Family";
  rows.people[1].Comments = "";
  const result = await assess(rows);
  assert.deepEqual(errors(result), []);
  assert.equal(result.plan.people[0].data.familyLine, "Synthetic Line Family");
  assert.match(String(result.plan.people[0].data.financialNotes), /Synthetic Line Family/);
  assert.equal(result.plan.people[1].data.familyLine, "");
});
test("overlong family-line comments block rather than truncate", async () => {
  const rows = syntheticRows(); rows.people[0].Comments = "x".repeat(201);
  assert.ok(errors(await assess(rows)).some(i => /200 characters/.test(i.message)));
});
test("zero quantities supported but excess precision and missing mandatory dates rejected", () => {
  assert.equal(quantity(0), 0); assert.equal(quantity("0.00"), 0); assert.equal(quantity(0.01), 0.01);
  for (const bad of [-1, "0.001", "1e2", "", "1,000", 1000000000000.01]) assert.throws(() => quantity(bad));
  assert.throws(() => quantity(0, false));
  for (const bad of ["", "2020-02-30", "1940-13-01", "01/01/1940"]) assert.throws(() => calendarDate(bad));
  assert.equal(calendarDate("1940-01-01"), "1940-01-01");
});
test("mismatched control totals block", async () => {
  const rows = syntheticRows(); rows.ownership[0].Common = 7.76;
  assert.ok(code(await assess(rows), "BALANCE_MISMATCH"));
});
test("raw and detailed certificate differences block", async () => {
  const rows = syntheticRows(); rows.common[0]["Shares Issued"] = 11;
  assert.ok(errors(await assess(rows)).length);
});
test("duplicate certificates and technical IDs block within scope", async () => {
  const rows = syntheticRows(); rows.securities.push({ ...rows.securities[0] });
  assert.ok(errors(await assess(rows)).length);
});
test("duplicate External IDs and ambiguous owner crosswalks block", async () => {
  const rows = syntheticRows(); rows.people.push({ ...rows.people[0] }); rows.rawPeople.push({ ...rows.rawPeople[0] });
  assert.ok(errors(await assess(rows)).length);
});
test("unknown owners excluded visibly from sample scope, never fabricated", async () => {
  const rows = syntheticRows(); rows.securities.push({ ...rows.securities[0], Id: "unmapped", CertificateId: "C-9999", StakeholderId: "missing" });
  const result = await assess(rows);
  assert.equal(result.counts.excludedSecurities, 1); assert.equal(result.plan.certificates.length, 3);
  assert.ok(code(result, "OUTSIDE_SAMPLE_SCOPE")); assert.deepEqual(errors(result), []);
});
test("detailed owner without a profile blocks", async () => {
  const rows = syntheticRows(); rows.common[0]["Stakeholder External ID"] = "unknown";
  assert.ok(code(await assess(rows), "MISSING_DETAIL_OWNER"));
});
test("missing ownership evidence blocks", async () => {
  const files = await fixtureFiles();
  const { sheets } = await readWorkbooks(files);
  assert.ok(code(convert(sheets.filter(s => s.name !== "Ownership")), "MISSING_OWNERSHIP"));
});
test("unsupported partial cancellation or repurchase blocks rather than becomes transfer", async () => {
  for (const field of ["RepurchasedAmount", "SharesRepurchased"]) {
    const rows = syntheticRows(); rows.securities[0][field] = 1;
    assert.ok(errors(await assess(rows)).length);
  }
  const rows = syntheticRows(); rows.common[0]["Shares Cancelled"] = 1;
  assert.ok(errors(await assess(rows)).length);
});
test("class and prefix mismatch blocks", async () => {
  const rows = syntheticRows(); rows.securities[0].SecurityClassId = "preferred";
  assert.ok(errors(await assess(rows)).length);
});
test("unknown vesting stays explicitly unknown", async () => {
  const rows = syntheticRows(); rows.common[0]["Vesting Schedule"] = "";
  const result = await assess(rows);
  assert.ok(code(result, "UNKNOWN_VESTING")); assert.match(result.plan.certificates[0].vestingSchedule, /not supplied/);
});
test("explicit verified transfer and allocations preserve history without replay", async () => {
  const result = await assess(syntheticRows(), true);
  assert.deepEqual(errors(result), []); assert.equal(result.plan.transfers.length, 1);
  assert.equal(result.plan.transfers[0].quantity, 2.5);
  assert.equal(result.plan.transfers[0].transferDate, "1950-01-01");
  assert.equal(result.counts.commonShares, 10.25);
});
test("verified same-owner batch sources produce one destination transfer", async () => {
  const rows = syntheticRows();
  rows.securities[0].OutstandingAmount = 9; rows.securities[0].CancelledAmount = 1.25;
  rows.common[0]["Shares Outstanding"] = 9; rows.common[0]["Shares Transferred"] = 1.25;
  rows.securities.push({ ...rows.securities[0], Id: "sec4", CertificateId: "C-9003", IssuedAmount: 1.25, OutstandingAmount: 0, Status: "TRANSFERRED" });
  rows.common.push({ ...rows.common[0], "Certificate ID": "C-9003", "Shares Issued": 1.25, "Shares Outstanding": 0 });
  rows.ownership[0].Common = 9;
  rows.allocations[0].quantity = 1.25;
  rows.allocations.push({ ...rows.allocations[0], source_certificate_id: "C-9003" });
  const result = await assess(rows, true);
  assert.deepEqual(errors(result), []); assert.equal(result.plan.transfers.length, 1);
  assert.equal(result.plan.transfers[0].sources.length, 2); assert.equal(result.plan.transfers[0].quantity, 2.5);
  assert.equal(result.counts.commonShares, 11.5);
});
test("history without an evidence reference is not promoted", async () => {
  const rows = syntheticRows(); rows.transfers[0].evidence_reference = "";
  assert.ok(code(await assess(rows, true), "INVALID_TRANSFER"));
});
test("cached formulas are static evidence and missing required cached results block", async () => {
  const rows = syntheticRows();
  rows.ownership[0].Common = { formula: "7+0.75", result: 7.75 };
  const files = await fixtureFiles(rows), books = await readWorkbooks(files);
  assert.equal(books.formulaSources.length, 1);
  assert.deepEqual(errors(convert(books.sheets)), []);
  rows.securities[0].IssuedAmount = { formula: "10+0.25" };
  assert.ok(errors(await assess(rows)).length);
});
test("incomplete, duplicate and cross-class transfer allocations block", async () => {
  for (const mode of ["missing", "duplicate", "class", "wrongDate", "excess"]) {
    const rows = syntheticRows();
    if (mode === "missing") rows.allocations[0].quantity = 2;
    if (mode === "duplicate") rows.allocations.push({ ...rows.allocations[0] });
    if (mode === "class") rows.allocations[0].source_certificate_id = "P-9001";
    if (mode === "wrongDate") rows.transfers[0].transfer_date = "1930-01-01";
    if (mode === "excess") rows.transfers[0].quantity = 20;
    assert.ok(errors(await assess(rows, true)).length, mode);
  }
});
test("staging writes no shareholder, certificate or transfer rows", async () => {
  const run = await stageImport(await fixtureFiles(), actor);
  assert.equal(run.status, "ready");
  assert.equal((await db.select().from(shareholdersTable)).length, 0);
  assert.equal((await db.select().from(certificatesTable)).length, 0);
  assert.equal((await db.select().from(shareTransfersTable)).length, 0);
});
test("warnings require explicit acknowledgment, blocked runs cannot commit", async () => {
  const run = await stageImport(await fixtureFiles(), actor);
  await assert.rejects(commitImport(run.id, actor, false), /acknowledge/);
  const rows = syntheticRows(); rows.ownership[0].Common = 0;
  const blocked = await stageImport(await fixtureFiles(rows), actor);
  await assert.rejects(commitImport(blocked.id, actor, true), /blocking/);
  assert.equal((await db.select().from(shareholdersTable)).length, 0);
});
test("commit, concurrent retry and reordered package create one ledger only", async () => {
  const files = await fixtureFiles(syntheticRows(), true);
  const run = await stageImport(files, actor);
  const results = await Promise.all([commitImport(run.id, actor, true), commitImport(run.id, actor, true)]);
  assert.ok(results.every(r => r.status === "committed"));
  assert.equal((await db.select().from(shareholdersTable)).length, 2);
  assert.equal((await db.select().from(certificatesTable)).length, 3);
  assert.equal((await db.select().from(shareTransfersTable)).length, 1);
  assert.equal((await stageImport(files.reverse(), actor)).id, run.id);
  const cert = (await db.select().from(certificatesTable).where(eq(certificatesTable.id, "C-9001")))[0];
  assert.equal(cert.quantity, 10.25); assert.equal(cert.transferredQuantity, 2.5); assert.equal(cert.issueDate, "1940-01-01");
  const activities = await db.select().from(activityTable);
  assert.ok(activities.every(a => a.actor === actor.id)); assert.ok(activities.every(a => a.createdAt.getFullYear() > 2000));
  assert.equal((await db.select().from(settingsAuditTable)).length, 1);
  const requests = await db.execute(sql`SELECT (SELECT count(*) FROM transfer_requests)+(SELECT count(*) FROM signoff_email_notifications) AS count`);
  assert.equal(Number(requests.rows[0].count), 0);
});
test("changed file cannot overwrite previously imported legacy identities", async () => {
  const first = await stageImport(await fixtureFiles(), actor); await commitImport(first.id, actor, true);
  const rows = syntheticRows(); rows.people[0].Name = "Changed";
  const second = await stageImport(await fixtureFiles(rows), actor);
  assert.equal(second.status, "blocked"); assert.ok(second.issues.some(i => i.code === "EXISTING_RECORD"));
});
test("renamed certificate cannot reuse an imported legacy security ID", async () => {
  const first = await stageImport(await fixtureFiles(), actor); await commitImport(first.id, actor, true);
  const rows = syntheticRows();
  rows.people.forEach((p, i) => { p["External ID"] = `OTHER-${i}`; });
  rows.rawPeople.forEach((p, i) => { p.ExternalId = `OTHER-${i}`; });
  rows.ownership.forEach((p, i) => { p["Stakeholder External ID"] = `OTHER-${i}`; });
  for (const row of [...rows.common, ...rows.preferred]) row["Stakeholder External ID"] = row["Stakeholder External ID"] === "SYN-1" ? "OTHER-0" : "OTHER-1";
  for (const row of rows.securities) row.CertificateId = String(row.CertificateId).replace("900", "910");
  for (const row of [...rows.common, ...rows.preferred]) row["Certificate ID"] = String(row["Certificate ID"]).replace("900", "910");
  const second = await stageImport(await fixtureFiles(rows), actor);
  assert.equal(second.status, "blocked");
  assert.ok(second.issues.some(i => /legacy security IDs/.test(i.message)));
});
test("conflicts introduced after staging block atomically without overwriting", async () => {
  const run = await stageImport(await fixtureFiles(), actor);
  await db.insert(shareholdersTable).values({ id: "unrelated", data: { generationNumber: "SYN-1", name: "Unrelated existing record" } });
  await assert.rejects(commitImport(run.id, actor, true), /External ID/);
  assert.equal((await db.select().from(shareholdersTable)).length, 1);
  assert.equal((await db.select().from(certificatesTable)).length, 0);
});
test("counter floors are preserved independently", async () => {
  await db.insert(certificateCountersTable).values([{ shareClass: "Common", lastNumber: 10000 }, { shareClass: "Preferred", lastNumber: 1 }]);
  const run = await stageImport(await fixtureFiles(), actor); await commitImport(run.id, actor, true);
  const counters = await db.select().from(certificateCountersTable);
  assert.equal(counters.find(c => c.shareClass === "Common")?.lastNumber, 10000);
  assert.equal(counters.find(c => c.shareClass === "Preferred")?.lastNumber, 9001);
});
test("database failure rolls back complete ledger and retains ready run for recovery", async () => {
  const run = await stageImport(await fixtureFiles(), actor);
  // Simulate damaged staging: database CHECK must abort the whole transaction.
  await db.execute(sql`UPDATE legacy_import_runs SET payload=jsonb_set(payload,'{certificates,0,quantity}','-1') WHERE id=${run.id}`);
  await assert.rejects(commitImport(run.id, actor, true));
  assert.equal((await db.select().from(shareholdersTable)).length, 0);
  assert.equal((await db.select().from(certificatesTable)).length, 0);
  assert.equal((await db.select().from(activityTable)).length, 0);
  assert.equal((await db.select().from(legacyImportRunsTable))[0].status, "ready");
});
test("SSN is encrypted before staging and absent from reports and audit", async () => {
  process.env.SESSION_SECRET = "synthetic-only-test-secret-not-used-outside-private-cluster";
  const rows = syntheticRows(); rows.people[0].SSN = "123-45-6789";
  const run = await stageImport(await fixtureFiles(rows), actor);
  assert.ok(!JSON.stringify(run).includes("123-45-6789")); assert.ok(!JSON.stringify(run).includes("123456789"));
  const stored = (await db.select().from(legacyImportRunsTable))[0];
  assert.ok(!JSON.stringify(stored).includes("123456789"));
  await commitImport(run.id, actor, true);
  const people = await db.select().from(shareholdersTable);
  assert.ok(people.some(p => p.ssnEncrypted?.startsWith("v1.") && p.ssnLast4 === "6789"));
  assert.ok(!JSON.stringify(await db.select().from(activityTable)).includes("6789"));
});
test("production, Azure and published-development gates fail closed", () => {
  assert.equal(importAvailability({ NODE_ENV: "production", DATABASE_PROVIDER: "replit" }).enabled, false);
  assert.equal(importAvailability({ NODE_ENV: "development", DATABASE_PROVIDER: "azure" }).enabled, false);
  assert.equal(importAvailability({ NODE_ENV: "development", DATABASE_PROVIDER: "replit", REPLIT_DEPLOYMENT: "true" }).enabled, false);
  assert.equal(importAvailability({ NODE_ENV: "development", DATABASE_PROVIDER: "replit" }).enabled, true);
});
test("commit and stage cannot run when execution environment is production", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(stageImport([], actor), /disabled/);
    await assert.rejects(commitImport("anything", actor, true), /disabled/);
  } finally { process.env.NODE_ENV = previous; }
});
test("API requires sign-in, validates attestation and returns template", async () => {
  const app = express(); app.use(express.json({ limit: "8mb" })); app.use("/api", router);
  assert.equal((await request(app).get("/api/settings/data-import/status")).status, 401);
  const signed = express(); signed.use(express.json({ limit: "8mb" }));
  signed.use((req, _res, next) => { req.user = { id: actor.id, firstName: "Synthetic", lastName: "Operator", email: null, emailVerified: false, profileImageUrl: null }; next(); });
  signed.use("/api", router);
  assert.equal((await request(signed).get("/api/settings/data-import/status")).body.enabled, true);
  assert.equal((await request(signed).post("/api/settings/data-import/analyze").send({ syntheticOnly: false, files: await fixtureFiles() })).status, 400);
  const response = await request(signed).post("/api/settings/data-import/analyze").send({ syntheticOnly: true, files: await fixtureFiles() });
  assert.equal(response.status, 201); assert.equal(response.body.status, "ready");
  const committed = await request(signed).post(`/api/settings/data-import/runs/${response.body.id}/commit`).send({ acknowledgeWarnings: true, syntheticOnly: true });
  assert.equal(committed.status, 200); assert.equal(committed.body.status, "committed");
  const template = await request(signed).get("/api/settings/data-import/template");
  assert.equal(template.status, 200); assert.match(template.headers["content-disposition"], /xlsx/);
});
test("invalid workbooks, archives, repeated files and path names are rejected", async () => {
  assert.throws(() => validateArchive(Buffer.from("not an xlsx")));
  const files = await fixtureFiles();
  await assert.rejects(readWorkbooks([files[0], files[0], files[1]]), /more than once/);
  await assert.rejects(readWorkbooks([{ ...files[0], name: "../bad.xlsx" }, ...files.slice(1)]), /filename/);
  await assert.rejects(readWorkbooks([{ ...files[0], base64: "not valid!" }, ...files.slice(1)]), /encoding/);
  const tampered = Buffer.from(files[0].base64, "base64");
  // Forge an archive expansion claim; verify actual inflation catches it.
  for (let i = 0; i < tampered.length - 46; i++) {
    if (tampered.readUInt32LE(i) === 0x02014b50 && tampered.readUInt32LE(i + 24) > 10) {
      tampered.writeUInt32LE(1, i + 24); break;
    }
  }
  assert.throws(() => validateArchive(tampered), /damaged or oversized/);
});
