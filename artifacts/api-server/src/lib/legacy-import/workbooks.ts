import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { CertificateError } from "../certificates";

export type SourceFile = { name: string; base64: string };
export type Row = Record<string, unknown> & { _location: string };
export type Sheet = { name: string; file: string; rows: unknown[][] };
export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const text = (v: unknown) => v === null || v === undefined ? "" : String(v).trim();

/** Bound XLSX ZIP expansion before ExcelJS allocates decompressed contents.
 * ZIP64, encryption and external-file archives are deliberately unsupported. */
export function validateArchive(bytes: Buffer) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50)
    throw new CertificateError(400, "Choose standard XLSX workbooks, not renamed CSV or ZIP files.");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    throw new CertificateError(400, "Unsupported workbook archive.");
  const entries = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16), expanded = 0;
  if (entries > 500 || entries === 65535) throw new CertificateError(400, "Workbook has too many archive entries.");
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw new CertificateError(400, "Invalid workbook archive directory.");
    if (bytes.readUInt16LE(cursor + 8) & 1) throw new CertificateError(400, "Password-protected workbooks are not supported.");
    const size = bytes.readUInt32LE(cursor + 24);
    const compressed = bytes.readUInt32LE(cursor + 20), method = bytes.readUInt16LE(cursor + 10);
    expanded += size;
    if (size === 0xffffffff || expanded > 40 * 1024 * 1024)
      throw new CertificateError(400, "Workbook expands beyond the 40 MB processing limit.");
    const local = bytes.readUInt32LE(cursor + 42);
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50)
      throw new CertificateError(400, "Invalid workbook entry.");
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressed > bytes.length || ![0, 8].includes(method))
      throw new CertificateError(400, "Unsupported workbook entry compression.");
    try {
      // Do not trust a forged directory's expansion claims. Bound actual
      // inflation before ExcelJS sees even one archive entry.
      const data = method === 0 ? bytes.subarray(start, start + compressed)
        : inflateRawSync(bytes.subarray(start, start + compressed), { maxOutputLength: Math.max(1, size) });
      if (data.length !== size) throw new Error("Size mismatch");
    } catch { throw new CertificateError(400, "Workbook contains a damaged or oversized compressed entry."); }
    cursor += 46 + bytes.readUInt16LE(cursor + 28) + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    if (cursor > end) throw new CertificateError(400, "Invalid workbook directory bounds.");
  }
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    // Never evaluate a formula or follow links. Pulley summary sheets contain
    // formulas; their saved scalar result is treated as static export evidence.
    // Missing cached results stay blank and required-field validation blocks.
    if ("formula" in value || "sharedFormula" in value) {
      const result = value.result;
      if (result && typeof result === "object" && !(result instanceof Date))
        throw new CertificateError(400, "A formula has an unsupported cached result.");
      return result ?? null;
    }
    if ("richText" in value) return value.richText.map(p => p.text).join("");
    if ("text" in value) return value.text;
    if ("error" in value) throw new CertificateError(400, "A workbook contains an Excel error cell.");
  }
  return value;
}

export async function readWorkbooks(files: SourceFile[]) {
  if (files.length < 3 || files.length > 7) throw new CertificateError(400, "Select the source exports together (3–7 XLSX files).");
  const sheets: Sheet[] = [], sources: { name: string; sha256: string }[] = [], formulaSources: string[] = [];
  let total = 0;
  for (const file of files) {
    if (!/^[^/\\\u0000-\u001f]+\.xlsx$/i.test(file.name) || file.name.length > 255)
      throw new CertificateError(400, "Each file must have a plain XLSX filename.");
    if (!file.base64 || file.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(file.base64))
      throw new CertificateError(400, "Invalid workbook encoding.");
    const bytes = Buffer.from(file.base64, "base64");
    if (bytes.toString("base64") !== file.base64) throw new CertificateError(400, "Invalid workbook encoding.");
    total += bytes.length;
    if (total > 5 * 1024 * 1024) throw new CertificateError(413, "Source files must total no more than 5 MB.");
    validateArchive(bytes);
    const hash = digest(bytes);
    if (sources.some(s => s.name === file.name || s.sha256 === hash))
      throw new CertificateError(400, "The same workbook was supplied more than once.");
    sources.push({ name: file.name, sha256: hash });
    const book = new ExcelJS.Workbook();
    try { await book.xlsx.load(bytes as never); }
    catch { throw new CertificateError(400, "A source workbook could not be read. Re-export it as a standard XLSX file."); }
    let cells = 0, formulas = 0;
    for (const sheet of book.worksheets) {
      if (sheet.rowCount > 10000 || sheet.columnCount > 100)
        throw new CertificateError(400, "Workbook exceeds the sample limit of 10,000 rows or 100 columns per sheet.");
      const rows: unknown[][] = [];
      sheet.eachRow({ includeEmpty: true }, row => {
        const values: unknown[] = [];
        row.eachCell({ includeEmpty: true }, (cell, column) => {
          if (++cells > 500000) throw new CertificateError(400, "Workbook contains too many cells.");
          if (cell.value && typeof cell.value === "object" && ("formula" in cell.value || "sharedFormula" in cell.value)) formulas++;
          const value = cellValue(cell.value);
          if (typeof value === "string" && value.length > 10000)
            throw new CertificateError(400, "A workbook cell exceeds the text limit.");
          values[column - 1] = value;
        });
        rows.push(values);
      });
      sheets.push({ name: sheet.name, file: file.name, rows });
    }
    if (formulas) formulaSources.push(file.name);
  }
  return { sheets, sources, formulaSources };
}

/** Header detection, not fixed row numbers: Pulley reports contain cover rows. */
export function records(sheet: Sheet, required: string[]): Row[] {
  const header = sheet.rows.findIndex(row => required.every(h => row.some(c => text(c) === h)));
  if (header < 0) throw new CertificateError(400, `${sheet.name}: expected column headings were not found.`);
  const headings = sheet.rows[header].map(text);
  const nonempty = headings.filter(Boolean);
  if (new Set(nonempty).size !== nonempty.length) throw new CertificateError(400, `${sheet.name}: duplicate column headings.`);
  return sheet.rows.slice(header + 1).flatMap((values, index) => {
    if (!values.some(v => text(v))) return [];
    const row: Row = { _location: `${sheet.name}, row ${header + index + 2}` };
    headings.forEach((h, i) => { if (h) row[h] = values[i] ?? null; });
    return [row];
  });
}

export function oneSheet(sheets: Sheet[], name: string, required = false) {
  const matches = sheets.filter(s => s.name === name);
  if (matches.length > 1 || (required && !matches.length))
    throw new CertificateError(400, `Supply exactly one ${name} sheet.`);
  return matches[0];
}
