import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, pool, certificateTemplatesTable } from "@workspace/db";
import { installCertificateTemplate } from "../lib/certificate-documents";

// Explicit one-time development import, never a server startup or production migration.
try {
  for (const shareClass of ["Common", "Preferred"] as const) {
    const [existing] = await db.select().from(certificateTemplatesTable)
      .where(and(eq(certificateTemplatesTable.shareClass, shareClass), eq(certificateTemplatesTable.active, true)));
    if (existing) { process.stdout.write(`${shareClass}: active template already retained\n`); continue; }
    const bytes = await readFile(resolve(process.cwd(), `../../generated-artifacts/certificate-templates/${shareClass.toLowerCase()}-blank.pdf`));
    await installCertificateTemplate(bytes, shareClass, `${shareClass} blank certificate.pdf`, "system:provided-template");
    process.stdout.write(`${shareClass}: blank editable template retained\n`);
  }
} finally {
  await pool.end();
}
