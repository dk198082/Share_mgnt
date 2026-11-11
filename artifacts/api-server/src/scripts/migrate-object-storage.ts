import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  db,
  pool,
  uploadsTable,
  certificateTemplatesTable,
  certificateDocumentsTable,
  shareholdersTable,
  signoffsTable,
  transferRequestsTable,
  shareTransfersTable,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";

type MigrationRecord = {
  objectPath: string;
  sha256: string;
  size: number;
  contentType: string;
};

function addPath(paths: Set<string>, path: unknown) {
  if (typeof path === "string" && path) paths.add(path);
}

function addDocuments(paths: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (item && typeof item === "object") addPath(paths, (item as { objectPath?: unknown }).objectPath);
  }
}

async function collectObjectPaths(): Promise<string[]> {
  const paths = new Set<string>();
  for (const row of await db.select().from(uploadsTable)) addPath(paths, row.objectPath);
  for (const row of await db.select().from(certificateTemplatesTable)) addPath(paths, row.objectPath);
  for (const row of await db.select().from(certificateDocumentsTable)) addPath(paths, row.objectPath);
  for (const row of await db.select().from(signoffsTable)) addPath(paths, row.signaturePath);

  for (const row of await db.select().from(shareholdersTable)) {
    addPath(paths, row.data.picturePath);
    addDocuments(paths, row.data.documents);
  }
  for (const row of await db.select().from(transferRequestsTable)) {
    addDocuments(paths, row.input.attachments);
    for (const signer of row.requiredSigners ?? []) addPath(paths, signer.signaturePath);
    for (const signer of row.approvals) addPath(paths, signer.signaturePath);
  }
  for (const row of await db.select().from(shareTransfersTable)) addDocuments(paths, row.attachments);

  return [...paths].sort();
}

async function main() {
  const outputPath = resolve(process.argv[2] || `generated-artifacts/azure-object-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const storage = new ObjectStorageService();
  await storage.verifyAzureContainerIsPrivate();
  const objectPaths = await collectObjectPaths();
  const records: MigrationRecord[] = [];

  for (const [index, objectPath] of objectPaths.entries()) {
    if (!objectPath.startsWith("/objects/")) {
      throw new Error(`Unsupported object reference at item ${index + 1}; no source object was deleted.`);
    }
    const verified = await storage.copyLegacyObjectEntityToAzure(objectPath);
    records.push({ objectPath, ...verified });
    console.info(`Verified ${index + 1}/${objectPaths.length} file copies.`);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    createdAt: new Date().toISOString(),
    sourceDeleted: false,
    total: records.length,
    files: records,
  }, null, 2)}\n`, { flag: "wx" });
  console.info(`Verified ${records.length} object copies. Manifest: ${outputPath}`);
}

main()
  .catch(error => {
    console.error("Azure object migration stopped; source objects were not deleted.", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
