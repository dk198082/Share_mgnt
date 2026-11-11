import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { collectObjectPaths } from "../lib/object-references";
import { SharePointStoredObjectFile } from "../lib/sharepoint-storage";
import { sharePointClient, sharePointConfig, SharePointError } from "../lib/sharepoint-client";

async function main() {
  if (!["azure", "replit"].includes(process.env.OBJECT_STORAGE_PROVIDER ?? "")) {
    throw new Error("Set OBJECT_STORAGE_PROVIDER to the existing source (azure or replit).");
  }
  const verifyOnly = process.argv.includes("--verify-only");
  const output = resolve(fileURLToPath(new URL("../../../../generated-artifacts/", import.meta.url)),
    `sharepoint-${verifyOnly ? "verification" : "migration"}-${Date.now()}.json`);
  const root = await sharePointClient.info(sharePointConfig().root);
  if (!root.folder) throw new Error("The configured SharePoint root is not a folder.");
  const source = new ObjectStorageService();
  const paths = await collectObjectPaths();
  const report = { sourceProvider: process.env.OBJECT_STORAGE_PROVIDER, destination: "sharepoint", sourceDeleted: false,
    databaseChanged: false, verified: [] as Array<{ objectPath: string; sha256: string; size: number }>,
    failed: [] as Array<{ objectPath: string; errorType: string; status?: number; code?: string }>, referenceSetChanged: false };
  for (const [index, path] of paths.entries()) {
    try {
      if (!path.startsWith("/objects/")) throw new Error("Unsupported object reference.");
      const file = await source.getObjectEntityFile(path);
      const [metadata] = await file.getMetadata();
      const [bytes] = await file.download();
      if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !metadata.contentType) {
        throw new Error("Invalid source file size or missing MIME type.");
      }
      const destination = new SharePointStoredObjectFile(path.slice("/objects/".length));
      if (!verifyOnly) await destination.importVerified(bytes, metadata.contentType, metadata.metadata ?? {});
      const [copy] = await destination.download();
      const [copyMetadata] = await destination.getMetadata();
      if (!bytes.equals(copy) || metadata.contentType !== copyMetadata.contentType) throw new Error("Copy verification failed.");
      report.verified.push({ objectPath: path, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length });
      console.info(`Verified ${index + 1}/${paths.length} SharePoint files.`);
    } catch (error) {
      report.failed.push({ objectPath: path, errorType: error instanceof Error ? error.name : "Unknown",
        ...(error instanceof SharePointError ? { status: error.status, code: error.code } : {}) });
      console.error(`Could not verify source reference ${index + 1}/${paths.length}; ${error instanceof SharePointError ? error.message : error instanceof Error ? error.name : "unknown error"}; originals remain unchanged.`);
    }
  }
  report.referenceSetChanged = JSON.stringify(paths) !== JSON.stringify(await collectObjectPaths());
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ ...report, completedAt: new Date().toISOString() }, null, 2), { flag: "wx" });
  console.info(`Verified: ${report.verified.length}; failed: ${report.failed.length}; reference set changed: ${report.referenceSetChanged}. Report: ${output}`);
  if (report.failed.length || report.referenceSetChanged) throw new Error("SharePoint cutover blocked; resolve missing/conflicting files and rerun.");
}

main().catch(error => {
  console.error("SharePoint migration/verification stopped:", error instanceof Error ? error.message : "Unknown failure");
  process.exitCode = 1;
}).finally(() => pool.end());
