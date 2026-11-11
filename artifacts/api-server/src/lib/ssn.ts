import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

// Domain-separated from session signing. Preserve SESSION_SECRET or migrate
// encrypted values before rotating it. No raw SSN is returned by the API.
export function encryptSsn(value: string): string {
  if (!process.env.SESSION_SECRET) throw new Error("SSN encryption is not configured");
  const key = Buffer.from(hkdfSync("sha256", process.env.SESSION_SECRET, "shareholder-management", "ssn-encryption-v1", 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

// Compare internally without exposing the decrypted value or duplicating it in
// the audit log. Re-entering the same SSN is not a profile change.
export function matchesEncryptedSsn(encrypted: string, candidate: string): boolean {
  if (!process.env.SESSION_SECRET) throw new Error("SSN encryption is not configured");
  const [version, iv, tag, ciphertext] = encrypted.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid secured SSN format");
  const key = Buffer.from(hkdfSync("sha256", process.env.SESSION_SECRET, "shareholder-management", "ssn-encryption-v1", 32));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const actual = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]);
  const supplied = Buffer.from(candidate);
  return actual.length === supplied.length && timingSafeEqual(actual, supplied);
}
