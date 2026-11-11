import { PDFDocument, PDFTextField, PDFDict, PDFArray, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";

export type CertificatePdfInput = {
  certificateId: string; holderName: string; quantity: number; issueDate: string; shareClass: "Common" | "Preferred";
  signers: { name: string; image: Uint8Array }[];
};

export async function validateCertificateTemplate(bytes: Uint8Array): Promise<string[]> {
  if (bytes.length > 10 * 1024 * 1024 || Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-")
    throw new Error("Upload a PDF no larger than 10 MB.");
  const pdf = await PDFDocument.load(bytes);
  if (pdf.getPageCount() < 1 || pdf.getPageCount() > 10) throw new Error("Templates must contain 1–10 pages.");
  const seen = new Set<unknown>();
  const inspect = (object: unknown, depth = 0) => {
    if (seen.has(object)) return;
    seen.add(object);
    if (depth > 50) throw new Error("PDF structure is too deeply nested.");
    if (object instanceof PDFDict) {
      if (object.keys().some(k => ["/JS", "/JavaScript", "/OpenAction", "/A", "/AA", "/EmbeddedFiles", "/RichMediaContent"].includes(k.toString())))
        throw new Error("PDF scripts, automatic actions, and embedded files are not permitted.");
      for (const value of object.values()) inspect(value, depth + 1);
    } else if (object instanceof PDFArray) for (const value of object.asArray()) inspect(value, depth + 1);
  };
  for (const [, object] of pdf.context.enumerateIndirectObjects()) inspect(object);
  const form = pdf.getForm();
  if (form.hasXFA()) throw new Error("Use standard PDF form fields, not XFA.");
  const fields = form.getFields();
  if (fields.length > 100 || fields.some(f => !(f instanceof PDFTextField)))
    throw new Error("Use at most 100 standard text fields, including signature image placeholders.");
  if (fields.some(f => (f as PDFTextField).getText()?.trim()))
    throw new Error("Upload a blank PDF: clear every form field before saving the template.");
  const names = fields.map(f => f.getName());
  const has = (name: string) => names.includes(name);
  if (!has("certificateId") || !has("quantity") || !(has("issueDate") || has("witnessText")) ||
      !(has("holderName") || has("certificateIntro")) || !has("signature1") || !has("signer1Name"))
    throw new Error("Required text fields: certificateId, quantity, holderName (or certificateIntro), issueDate (or witnessText), signature1, signer1Name.");
  return names;
}

export async function renderCertificatePdf(template: Uint8Array, data: CertificatePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(template);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const form = pdf.getForm();
  const values: Record<string, string> = {
    certificateId: data.certificateId, holderName: data.holderName, quantity: String(data.quantity),
    shareClass: data.shareClass, issueDate: data.issueDate,
    certificateIntro: data.shareClass === "Common"
      ? `THIS CERTIFIES THAT ${data.holderName} is the registered holder of ${data.quantity} FULLY PAID AND NON-ASSESSABLE`
      : `This certifies that ${data.holderName} is the stockholder of ${data.quantity} shares of Preferred`,
    witnessText: data.shareClass === "Common"
      ? `WITNESS, the signature of duly authorized officers of the corporation and its seal, ${data.issueDate}.`
      : `Dated: ${data.issueDate}`,
  };
  const placements: { index: number; pageIndex: number; rect: { x: number; y: number; width: number; height: number } }[] = [];
  for (const field of form.getFields()) {
    if (!(field instanceof PDFTextField)) continue;
    const name = field.getName();
    const signerName = /^signer(\d+)Name$/.exec(name);
    const signature = /^signature(\d+)$/.exec(name);
    if (signature) {
      const widget = field.acroField.getWidgets()[0];
      const pageRef = widget?.P();
      const pageIndex = pdf.getPages().findIndex(p => p.ref === pageRef);
      if (!widget || pageIndex < 0) throw new Error(`Signature placeholder ${name} must belong to a PDF page.`);
      placements.push({ index: Number(signature[1]) - 1, pageIndex, rect: widget.getRectangle() });
      field.setText("");
    } else {
      field.setText(signerName ? data.signers[Number(signerName[1]) - 1]?.name ?? "" : values[name] ?? "");
      field.setFontSize(0);
    }
  }
  form.updateFieldAppearances(font);
  form.flatten();
  const placed = new Set<number>();
  for (const placement of placements) {
    const signer = data.signers[placement.index];
    if (!signer) continue;
    const png = await sharp(signer.image, { limitInputPixels: 20_000_000 }).png().toBuffer();
    const image = await pdf.embedPng(png);
    const { rect } = placement;
    const size = image.scaleToFit(rect.width, rect.height);
    pdf.getPage(placement.pageIndex).drawImage(image, {
      x: rect.x, y: rect.y + (rect.height - size.height) / 2, ...size,
    });
    placed.add(placement.index);
  }
  // Never discard approvals when the signer count exceeds the template's signature spaces.
  let appendix: ReturnType<typeof pdf.addPage> | undefined;
  let y = 0;
  for (const [i, signer] of data.signers.entries()) {
    if (placed.has(i)) continue;
    if (!appendix || y < 130) {
      appendix = pdf.addPage([792, 612]); y = 510;
      appendix.drawText(`Certificate ${data.certificateId} - additional recorded approvals`, { x: 60, y: 560, size: 16, font });
    }
    const image = await pdf.embedPng(await sharp(signer.image).png().toBuffer());
    const size = image.scaleToFit(300, 50);
    appendix.drawImage(image, { x: 60, y: y - 50, ...size });
    appendix.drawText(signer.name, { x: 60, y: y - 70, size: 11, font, color: rgb(0, 0, 0) });
    y -= 115;
  }
  pdf.setTitle(`Certificate ${data.certificateId}`);
  pdf.setAuthor("Shareholder Management");
  return pdf.save();
}
