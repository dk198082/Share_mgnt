import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import { importAvailability, importConfiguration, requireImportUpload } from "./access";
import { configuredApplicationOrigin } from "../application-origin";
import { db, pool, shareholdersTable, legacyImportRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fixtureFiles, syntheticRows } from "./fixtures.test-support";
import { readWorkbooks } from "./workbooks";
import { convert } from "./convert";
import { SharePointStoredObjectFile } from "../sharepoint-storage";
import router from "../../routes/legacy-import";

export const azureFixture: NodeJS.ProcessEnv = {
  NODE_ENV: "production", DATABASE_PROVIDER: "azure", OBJECT_STORAGE_PROVIDER: "sharepoint",
  APP_PUBLIC_ORIGIN: "https://synthetic-shareholders.azurewebsites.net",
  WEBSITE_HOSTNAME: "synthetic-shareholders.azurewebsites.net", WEBSITE_INSTANCE_ID: "synthetic-instance",
  WEBSITE_SITE_NAME: "synthetic-shareholders", TENANT_ID: "00000000-0000-4000-8000-000000000001",
  CLIENT_ID: "synthetic-client", CLIENT_SECRET: "synthetic-test-only-secret",
  SHAREPOINT_HOSTNAME: "synthetic.sharepoint.com", SHAREPOINT_SITE_PATH: "sites/synthetic",
  SHAREPOINT_LIBRARY: "Documents", SHAREPOINT_ROOT_FOLDER: "SyntheticImport",
};
export const azureActor = () => ({
  id: "00000000-0000-4000-8000-000000000002", name: "Synthetic Employee",
});
// Changes only this isolated test worker; never configures a deployment.
export async function withAzureFixture(fn: () => Promise<void>) {
  const keys = [...Object.keys(azureFixture), "LEGACY_IMPORT_MODE", "LEGACY_IMPORT_ENABLED", "REPL_ID", "REPLIT_DEPLOYMENT", "REPLIT_DEV_DOMAIN"];
  const before = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, azureFixture);
  try { await fn(); } finally {
    for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
  }
}
test("Azure imports work automatically with existing app configuration, retaining host and data boundaries", () => {
  assert.equal(importAvailability(azureFixture, azureActor()).enabled, true);
  for (const [key, value] of [
    ["LEGACY_IMPORT_MODE", "unknown"], ["NODE_ENV", "development"],
    ["DATABASE_PROVIDER", "replit"], ["OBJECT_STORAGE_PROVIDER", "azure"], ["WEBSITE_INSTANCE_ID", undefined],
    ["APP_PUBLIC_ORIGIN", undefined], ["APP_PUBLIC_ORIGIN", "http://bad.example.test"],
    ["APP_PUBLIC_ORIGIN", "https://bad.example.test/path"], ["APP_PUBLIC_ORIGIN", "https://pilot.replit.app"],
    ["TENANT_ID", undefined], ["REPLIT_DEPLOYMENT", "true"],
    ["LEGACY_IMPORT_ENABLED", "TRUE"], ["SHAREPOINT_LIBRARY", undefined],
    ["REPLIT_DEV_DOMAIN", "test.replit.dev"], ["REPL_ID", "synthetic-repl-id"],
  ]) assert.equal(importAvailability({ ...azureFixture, [key!]: value }, azureActor()).enabled, false, `${key}=${value}`);
  assert.equal(importAvailability({ ...azureFixture, LEGACY_IMPORT_MODE: "off" }, azureActor()).enabled, false);
  assert.equal(importAvailability({ ...azureFixture, LEGACY_IMPORT_ENABLED: "false" }, azureActor()).enabled, false);
});
test("Container Apps is also recognized, without trusting request headers", () => {
  const env = { ...azureFixture, WEBSITE_INSTANCE_ID: undefined, CONTAINER_APP_NAME: "fixture", CONTAINER_APP_REVISION: "fixture-rev",
    CONTAINER_APP_REPLICA_NAME: "fixture-replica", CONTAINER_APP_HOSTNAME: "fixture.region.azurecontainerapps.io" };
  assert.equal(importConfiguration(env).available, true);
});
test("any existing signed-in employee can import without roles, new claims or another sign-in", () => {
  const actor = azureActor();
  assert.equal(importAvailability(azureFixture).enabled, false);
  assert.equal(importAvailability(azureFixture, { id: "", name: "" }).enabled, false);
  assert.equal(importAvailability(azureFixture, actor).enabled, true);
  assert.equal(importAvailability(azureFixture, { id: "00000000-0000-4000-8000-000000000003", name: "Another Employee" }).enabled, true);
  assert.equal(importAvailability({ ...azureFixture, LEGACY_IMPORT_ENTRA_ROLE: "obsolete-unused-value" }, actor).enabled, true);
});
test("explicit public origin rejects arbitrary callbacks and ambiguous settings", () => {
  assert.equal(configuredApplicationOrigin({ APP_PUBLIC_ORIGIN: "https://app.example.test/" }), "https://app.example.test");
  for (const value of ["https://app.example.test/path", "https://user@app.example.test", "https://app.example.test?x=1", "https://app.example.test:444", "http://app.example.test"])
    assert.throws(() => configuredApplicationOrigin({ APP_PUBLIC_ORIGIN: value }));
});
test("signed-out uploads are rejected before parsing bytes or trusting identity headers", async () => {
  await withAzureFixture(async () => {
    let bodyParsed = false;
    const app = express();
    app.use(requireImportUpload, (_req, _res, next) => { bodyParsed = true; next(); }, express.json());
    app.post("/", (_req, res) => { res.sendStatus(200); });
    await request(app).post("/").set("x-user-id", azureActor().id).send('{"userId":"forged", broken').expect(401);
    assert.equal(bodyParsed, false);
  });
});
test("ordinary Azure employees can stage, view history and commit, while signed-out callers cannot", async t => {
  assert.equal(process.env.LEGACY_IMPORT_TEST_CLUSTER, "owned-disposable", "Azure policy tests must use their own disposable database");
  try {
    await withAzureFixture(async () => {
      const stored = new Map<string, Buffer>();
      t.mock.method(SharePointStoredObjectFile.prototype, "exists", async function(this: SharePointStoredObjectFile) { return [stored.has(this.name)]; });
      t.mock.method(SharePointStoredObjectFile.prototype, "save", async function(this: SharePointStoredObjectFile, bytes: Buffer) { stored.set(this.name, Buffer.from(bytes)); });
      t.mock.method(SharePointStoredObjectFile.prototype, "download", async function(this: SharePointStoredObjectFile) { return [stored.get(this.name)!]; });
      const rows = syntheticRows();
      // Distinct, wholly synthetic certificate numbers in the owned cluster.
      rows.securities.forEach(r => { r.CertificateId = String(r.CertificateId).replace("900", "1900"); });
      rows.common.forEach(r => { r["Certificate ID"] = String(r["Certificate ID"]).replace("900", "1900"); });
      rows.preferred.forEach(r => { r["Certificate ID"] = String(r["Certificate ID"]).replace("900", "1900"); });
      rows.transfers[0].recipient_certificate_id = "C-19002";
      rows.allocations[0].source_certificate_id = "C-19001";
      const files = await fixtureFiles(rows, true);
      let signedIn = true, employeeId = azureActor().id;
      const app = express();
      app.use((req, _res, next) => {
        if (signedIn) req.user = { id: employeeId, firstName: "Synthetic", lastName: "Employee", email: null, emailVerified: false, profileImageUrl: null, role: "editor" };
        next();
      });
      app.use("/api/settings/data-import/analyze", requireImportUpload);
      app.use(express.json({ limit: "8mb" })); app.use("/api", router);
      assert.equal((await request(app).get("/api/settings/data-import/status")).body.requiresSyntheticData, false);
      await request(app).post("/api/settings/data-import/analyze").send({ syntheticOnly: true, files }).expect(400);
      const stage = await request(app).post("/api/settings/data-import/analyze").send({ syntheticOnly: false, files }).expect(201);
      assert.equal(stage.body.status, "ready");
      assert.equal(stored.size, files.length);
      assert.ok(stage.body.sources.every((s: { objectPath?: string }) => s.objectPath?.startsWith("/objects/uploads/legacy-import-")));
      signedIn = false;
      await request(app).get("/api/settings/data-import/status").expect(401);
      await request(app).get("/api/settings/data-import/runs").expect(401);
      await request(app).get("/api/settings/data-import/template").expect(401);
      await request(app).post("/api/settings/data-import/analyze").set("x-user-id", employeeId).send({ syntheticOnly: false, files }).expect(401);
      await request(app).post(`/api/settings/data-import/runs/${stage.body.id}/commit`).send({ syntheticOnly: false, acknowledgeWarnings: true }).expect(401);
      const [uncommitted] = await db.select().from(legacyImportRunsTable).where(eq(legacyImportRunsTable.id, stage.body.id));
      assert.equal(uncommitted.status, "ready");
      signedIn = true;
      employeeId = "00000000-0000-4000-8000-000000000003";
      assert.equal((await request(app).get("/api/settings/data-import/status")).body.enabled, true);
      await request(app).get("/api/settings/data-import/runs").expect(200);
      await request(app).get("/api/settings/data-import/template").expect(200);
      const restaged = await request(app).post("/api/settings/data-import/analyze").send({ syntheticOnly: false, files }).expect(201);
      assert.equal(restaged.body.id, stage.body.id);
      const firstPath = [...stored.keys()][0], original = stored.get(firstPath)!;
      stored.set(firstPath, Buffer.from("tampered synthetic evidence"));
      await request(app).post(`/api/settings/data-import/runs/${stage.body.id}/commit`).send({ syntheticOnly: false, acknowledgeWarnings: true }).expect(409);
      const [afterTamper] = await db.select().from(legacyImportRunsTable).where(eq(legacyImportRunsTable.id, stage.body.id));
      assert.equal(afterTamper.status, "ready");
      stored.set(firstPath, original);
      const [run] = await db.select().from(legacyImportRunsTable).where(eq(legacyImportRunsTable.id, stage.body.id));
      await db.update(legacyImportRunsTable).set({ payload: { ...run.payload, executionMode: "preview" } }).where(eq(legacyImportRunsTable.id, stage.body.id));
      await request(app).post(`/api/settings/data-import/runs/${stage.body.id}/commit`).send({ syntheticOnly: false, acknowledgeWarnings: true }).expect(409);
      await db.update(legacyImportRunsTable).set({ payload: run.payload }).where(eq(legacyImportRunsTable.id, stage.body.id));
      process.env.LEGACY_IMPORT_ENABLED = "false";
      await request(app).post(`/api/settings/data-import/runs/${stage.body.id}/commit`).send({ syntheticOnly: false, acknowledgeWarnings: true }).expect(403);
      delete process.env.LEGACY_IMPORT_ENABLED;
      await request(app).post(`/api/settings/data-import/runs/${stage.body.id}/commit`).send({ syntheticOnly: false, acknowledgeWarnings: true }).expect(200);
      const [completed] = await db.select().from(legacyImportRunsTable).where(eq(legacyImportRunsTable.id, stage.body.id));
      assert.equal(completed.committedBy, employeeId, "the employee who commits is still individually recorded");
      await request(app).post(`/api/settings/data-import/runs/${stage.body.id}/commit`).send({ syntheticOnly: false, acknowledgeWarnings: true }).expect(200);
      for (const id of stage.body.shareholderIds) {
        const [person] = await db.select().from(shareholdersTable).where(eq(shareholdersTable.id, id));
        assert.match(String(person.data.name), /^Synthetic/);
        assert.equal((person.data.legacyImport as { sampleOnly: boolean }).sampleOnly, false);
        assert.ok(!String(person.data.financialNotes).includes("ANONYMIZED LEGACY SAMPLE"));
      }
      rows.rawPeople.pop();
      const incomplete = convert((await readWorkbooks(await fixtureFiles(rows))).sheets, "azure");
      assert.ok(incomplete.issues.some(i => i.code === "UNRESOLVED_PRODUCTION_OWNERS" && i.severity === "error"));
    });
  } finally { await pool.end(); }
});
