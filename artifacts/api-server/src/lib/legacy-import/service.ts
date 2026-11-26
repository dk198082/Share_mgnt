import { db, legacyImportRunsTable, shareholdersTable, certificatesTable, certificateCountersTable, shareTransfersTable } from "@workspace/db";
import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { AnalyzeLegacyImportResponse, type LegacyImportIssue, type LegacyImportSource } from "@workspace/api-zod";
import { CertificateError, type Transaction } from "../certificates";
import { auditContext, change, recordActivity } from "../audit";
import { recordSettingsChange } from "../settings-audit";
import { convert, MAPPING_VERSION, type Plan, type Assessment } from "./convert";
import { digest, readWorkbooks, type SourceFile } from "./workbooks";
import { SharePointStoredObjectFile } from "../sharepoint-storage";
import { requireImportAccess, type ImportActor as Actor } from "./access";
export { importAvailability, requirePreviewImport } from "./access";

function present(row: typeof legacyImportRunsTable.$inferSelect) {
  return AnalyzeLegacyImportResponse.parse({
    ...row.report, id: row.id, status: row.status, operator: row.operatorName,
    createdAt: row.createdAt.toISOString(), committedAt: row.committedAt?.toISOString() ?? null,
  });
}
async function verifyRetainedSource(source: LegacyImportSource) {
  if (!/^\/objects\/uploads\/legacy-import-[a-f0-9]{64}$/.test(source.objectPath ?? "") || !/^[a-f0-9]{64}$/.test(source.sha256))
    throw new CertificateError(409, "Azure import requires verified retained source evidence. Stage the package again.");
  const [bytes] = await new SharePointStoredObjectFile(source.objectPath!.slice("/objects/".length)).download();
  if (digest(bytes) !== source.sha256) throw new CertificateError(409, "Retained source integrity verification failed. No ledger changes were saved.");
}
async function conflicts(tx: Transaction, plan: Plan): Promise<LegacyImportIssue[]> {
  const issues: LegacyImportIssue[] = [];
  const add = (message: string) => issues.push({ severity: "error", code: "EXISTING_RECORD", location: "Target database", message });
  if (plan.people.length) {
    const existing = await tx.select({ id: shareholdersTable.id }).from(shareholdersTable).where(inArray(shareholdersTable.id, plan.people.map(p => p.id)));
    if (existing.length) add(`${existing.length} legacy shareholder IDs already exist. Add-only import will not overwrite them.`);
    const keys = plan.people.map(p => p.externalId);
    const externalMatches = await tx.select({ id: shareholdersTable.id }).from(shareholdersTable)
      .where(sql`(${shareholdersTable.data}->>'generationNumber') IN (${sql.join(keys.map(k => sql`${k}`), sql`, `)})`);
    if (externalMatches.length) add("A supplied External ID already exists on a shareholder record. Resolve identity conflicts rather than create a duplicate.");
  }
  if (plan.certificates.length) {
    const existing = await tx.select({ id: certificatesTable.id }).from(certificatesTable).where(or(
      inArray(certificatesTable.id, plan.certificates.map(c => c.id)),
      inArray(certificatesTable.requestId, plan.certificates.map(c => `legacy-sample:certificate:${digest(c.legacyId)}`)),
      inArray(certificatesTable.requestId, plan.certificates.map(c => `legacy:certificate:${digest(c.legacyId)}`)),
    ));
    if (existing.length) add(`${existing.length} certificate numbers or legacy security IDs already exist. Existing certificates will not be replaced or renumbered.`);
  }
  if (plan.transfers.length) {
    const existing = await tx.select({ id: shareTransfersTable.id }).from(shareTransfersTable).where(inArray(shareTransfersTable.id, plan.transfers.map(t => t.id)));
    if (existing.length) add("A supplied legacy transaction ID was already imported.");
  }
  return issues;
}
export async function stageImport(files: SourceFile[], actor: Actor) {
  const mode = requireImportAccess(actor);
  const { sheets, sources, formulaSources } = await readWorkbooks(files);
  const fingerprint = digest(`${mode === "azure" ? "azure\n" : ""}${MAPPING_VERSION}\n${sources.map(s => s.sha256).sort().join("\n")}`);
  const [prior] = await db.select().from(legacyImportRunsTable).where(eq(legacyImportRunsTable.fingerprint, fingerprint));
  if (prior) return present(prior);
  const assessment = convert(sheets, mode);
  if (formulaSources.length) assessment.issues.push({
    severity: "warning", code: "CACHED_FORMULA_RESULTS", location: "Source workbooks",
    message: `${formulaSources.length} workbook(s) contain formulas. Only saved scalar values were read; no formulas or external links were executed. Certificate quantities are independently reconciled.`,
  });
  assessment.issues.push(...await db.transaction(tx => conflicts(tx, assessment.plan)));
  // Only Azure mode retains originals, privately in SharePoint. Bytes never
  // enter PostgreSQL. Stable content paths permit safe retries without replacing
  // existing files; a conflicting/incomplete file fails integrity verification.
  const retainedSources: LegacyImportSource[] = [];
  for (const source of sources) {
    if (mode === "preview") { retainedSources.push(source); continue; }
    requireImportAccess(actor);
    const name = `uploads/legacy-import-${digest(`${fingerprint}:${source.sha256}`)}`;
    const file = new SharePointStoredObjectFile(name);
    if (!(await file.exists())[0]) {
      const original = files.find(f => f.name === source.name)!;
      await file.save(Buffer.from(original.base64, "base64"), { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    }
    const [bytes] = await file.download();
    if (digest(bytes) !== source.sha256) throw new CertificateError(409, "The retained source file failed integrity verification. No ledger changes were saved.");
    retainedSources.push({ ...source, objectPath: `/objects/${name}` });
  }
  const report = {
    sources: retainedSources, counts: assessment.counts, issues: assessment.issues, balances: assessment.balances,
    shareholderIds: assessment.plan.people.map(p => p.id),
  };
  const id = `legacy-import-${fingerprint.slice(0, 24)}`;
  await db.insert(legacyImportRunsTable).values({
    id, fingerprint, status: assessment.issues.some(i => i.severity === "error") ? "blocked" : "ready",
    operatorId: actor.id, operatorName: actor.name, report,
    payload: { ...assessment.plan, mappingVersion: MAPPING_VERSION, executionMode: mode },
  }).onConflictDoNothing();
  const [row] = await db.select().from(legacyImportRunsTable).where(eq(legacyImportRunsTable.fingerprint, fingerprint));
  return present(row);
}
export async function listImports(actor: Actor) {
  requireImportAccess(actor);
  return (await db.select().from(legacyImportRunsTable).orderBy(desc(legacyImportRunsTable.createdAt)).limit(50)).map(present);
}

/** Add-only, single atomic promotion. No live issuance or transfer workflow is
 * called: historical numbers/dates remain unchanged and no emails/PDFs fire. */
export async function commitImport(id: string, actor: Actor, acknowledgeWarnings: boolean) {
  const mode = requireImportAccess(actor);
  const prefix = mode === "azure" ? "legacy" : "legacy-sample";
  return auditContext.run(actor, () => db.transaction(async tx => {
    // TEMPORARY DIAGNOSTIC: verify Azure PostgreSQL schema
        const schemaCheck = await tx.execute(sql`
          SELECT
            current_database() AS database_name,
            current_schema() AS schema_name,
            current_setting('search_path') AS search_path
        `);

        console.info(
          "LEGACY_IMPORT_DB_SCHEMA",
          schemaCheck.rows
        );
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('legacy-sample-import', 0))`);
    const [run] = await tx.select().from(legacyImportRunsTable).where(eq(legacyImportRunsTable.id, id)).for("update");
    if (!run) throw new CertificateError(404, "Import run not found.");
    if ((run.payload.executionMode ?? "preview") !== mode) throw new CertificateError(409, "The import run belongs to a different execution mode. Stage the source package again here.");
    if (run.status === "committed") return present(run);
    const report = run.report as unknown as Pick<Assessment, "issues" | "counts">;
    if (run.status !== "ready" || report.issues.some(i => i.severity === "error"))
      throw new CertificateError(409, "Resolve the blocking validation errors before importing.");
    if (report.issues.some(i => i.severity === "warning") && !acknowledgeWarnings)
      throw new CertificateError(409, "Review and acknowledge all warnings before importing.");
    if (run.payload.mappingVersion !== MAPPING_VERSION) throw new CertificateError(409, "The mapping version changed. Stage a new source package.");
    if (mode === "azure") {
      const sources = present(run).sources;
      if (!sources.length) throw new CertificateError(409, "Azure source evidence is missing. Stage the package again.");
      for (const source of sources) await verifyRetainedSource(source);
    }
    const plan = run.payload as unknown as Plan;
    // Normal issuance/transfer/profile writes must not race identity/counter
    // checks. Locks are released automatically with the atomic transaction.
    await tx.execute(sql`LOCK TABLE shareholders, certificates, certificate_counters, share_transfers IN SHARE ROW EXCLUSIVE MODE`);
    const errors = await conflicts(tx, plan);
    if (errors.length) throw new CertificateError(409, errors.map(e => e.message).join(" "));
    requireImportAccess(actor);
    for (const person of plan.people) {
      await tx.insert(shareholdersTable).values({
        id: person.id, data: person.data, ssnEncrypted: person.ssnEncrypted, ssnLast4: person.ssnLast4,
      });
      await recordActivity(tx, {
        shareholderId: person.id, name: String(person.data.name), actor: actor.id,
        action: mode === "preview" ? "Anonymized legacy sample imported" : "Legacy shareholder imported",
        changes: [change("Import run", null, run.id), change("Historical attribution", null, "Source history only; import operator/time are not historical actors or event times")],
      });
    }
    for (const certificate of plan.certificates) {
      const { legacyId, ...values } = certificate;
      await tx.insert(certificatesTable).values({
        ...values, requestId: `${prefix}:certificate:${digest(legacyId)}`, issuedBy: "legacy-import:historical-actor-unknown",
      });
      await recordActivity(tx, {
        shareholderId: certificate.shareholderId, name: String(plan.people.find(p => p.id === certificate.shareholderId)!.data.name),
        actor: actor.id, action: `Legacy certificate ${certificate.id} imported`,
        changes: [change("Certificate", null, certificate.id), change("Original shares", null, certificate.quantity),
          change("Verified transferred shares", null, certificate.transferredQuantity), change("Historical issue date", null, certificate.issueDate),
          change("Import run", null, run.id)],
      });
    }
    for (const transfer of plan.transfers) {
      const { legacyId, ...values } = transfer;
      await tx.insert(shareTransfersTable).values({
        ...values, requestId: `${prefix}:transfer:${digest(legacyId)}`,
        requestFingerprint: digest(JSON.stringify(transfer)), recordedBy: "legacy-import:historical-actor-unknown",
      });
      for (const holderId of [transfer.originatorId, transfer.recipientId]) await recordActivity(tx, {
        shareholderId: holderId, name: String(plan.people.find(p => p.id === holderId)!.data.name),
        actor: actor.id, action: "Verified legacy transfer imported",
        changes: [change("Transfer", null, transfer.id), change("Historical transfer date", null, transfer.transferDate), change("Import run", null, run.id)],
      });
    }
    // Do not advance from the excluded full-company raw inventory. Preserve
    // existing counter floors and use max numbers actually present in Preview.
    await tx.execute(sql`
      INSERT INTO certificate_counters(share_class,last_number)
      SELECT share_class,max(sequence_number) FROM certificates GROUP BY share_class
      ON CONFLICT(share_class) DO UPDATE SET last_number=greatest(certificate_counters.last_number,excluded.last_number)
    `);
    await recordSettingsChange(tx, {
      action: mode === "preview" ? "Anonymized legacy sample imported" : "Legacy data imported", targetId: run.id,
      changes: [change("Shareholders added", 0, plan.people.length), change("Certificates added", 0, plan.certificates.length),
        change("Verified transfers added", 0, plan.transfers.length), change("Environment", null, mode === "preview" ? "Replit Preview only; existing records preserved" : "Azure; existing records preserved")],
    });
    const [completed] = await tx.update(legacyImportRunsTable).set({
      status: "committed", committedAt: new Date(), committedBy: actor.id,
    }).where(eq(legacyImportRunsTable.id, run.id)).returning();
    return present(completed);
  }));
}
