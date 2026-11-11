import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { renderCertificatePdf, validateCertificateTemplate } from "../lib/certificate-pdf";

const image = await sharp(Buffer.from('<svg width="300" height="50"><text x="4" y="35" font-size="24" font-family="serif" font-style="italic">Verification Signer</text></svg>')).png().toBuffer();
for (const shareClass of ["Common", "Preferred"] as const) {
  const dir = resolve(process.cwd(), "../../generated-artifacts/certificate-templates");
  const template = await readFile(`${dir}/${shareClass.toLowerCase()}-blank.pdf`);
  await validateCertificateTemplate(template);
  const bytes = await renderCertificatePdf(template, {
    shareClass, certificateId: shareClass === "Common" ? "C-TEST" : "P-TEST",
    holderName: "Certificate Verification Holder", quantity: 155, issueDate: "2026-10-29",
    signers: [{ name: "Verification Signer One", image }, { name: "Verification Signer Two", image }],
  });
  await writeFile(`${dir}/${shareClass.toLowerCase()}-verification.pdf`, bytes);
  process.stdout.write(`${shareClass}: verification PDF generated (not a real issuance)\n`);
}
