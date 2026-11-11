import { db, uploadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CertificateError } from "./certificates";
import { ObjectStorageService } from "./objectStorage";

export function signatureImageMatches(bytes: Buffer, type: string) {
  return (type === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
    (type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (type === "image/webp" && bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP");
}
export async function validateSignature(path: string) {
  const [upload] = await db.select().from(uploadsTable).where(eq(uploadsTable.objectPath, path));
  if (!upload || upload.purpose !== "signature") throw new CertificateError(400, "Choose a registered signature image.");
  try {
    const file = await new ObjectStorageService().getObjectEntityFile(path);
    const [metadata] = await file.getMetadata();
    if (!["image/png","image/jpeg","image/webp"].includes(upload.contentType) || metadata.contentType !== upload.contentType ||
        Number(metadata.size) < 1 || Number(metadata.size) > 2097152) throw new Error("Invalid signature image");
    const chunks: Buffer[] = [];
    for await (const chunk of file.createReadStream({ start: 0, end: 23 })) chunks.push(Buffer.from(chunk));
    if (!signatureImageMatches(Buffer.concat(chunks), upload.contentType)) throw new Error("Not an image");
  } catch { throw new CertificateError(400, "Upload a complete PNG, JPEG or WebP signature image, up to 2 MB."); }
}
