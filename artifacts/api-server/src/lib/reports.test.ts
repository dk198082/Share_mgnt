import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
test("all report titles, headings and notes use Shareholder terminology", () => {
  for (const type of ["detailed-cap-table", "shareholder-information", "shareholder-transactions"] as const) {
    assert.doesNotMatch(JSON.stringify(run(type)), /stakeholder/i);
  }
});
import type { CertificateRow, ShareTransferRow } from "@workspace/db";
import { buildReport, ReportError, type ReportSource, type ReportType } from "./report-data";
import { reportWorkbook } from "./report-workbook";

const now = new Date("2026-10-29T12:00:00Z");
const cert = (id: string, shareholderId: string, quantity: number, issueDate: string, extra: Partial<CertificateRow> = {}): CertificateRow =>
  ({ id, shareholderId, quantity, issueDate, sequenceNumber: Number(id.slice(2)), shareClass: id.startsWith("P") ? "Preferred" : "Common",
    transferredQuantity: 0, status: "Outstanding", vestingSchedule: "Fully vested upon grant", createdAt: now, ...extra }) as CertificateRow;
const transfer = (sourceCertificateId: string, recipientCertificateId: string, originatorId: string, recipientId: string,
  quantity: number, transferDate: string): ShareTransferRow =>
  ({ id: recipientCertificateId, sourceCertificateId, recipientCertificateId, originatorId, recipientId, quantity, transferDate,
    originatorName: originatorId, recipientName: recipientId, shareClass: "Common", pricePerShare: "12.50", reason: "Gift", createdAt: now }) as ShareTransferRow;
function fixture(): ReportSource {
  return {
    holders: [
      { id: "a", ssnLast4: "1234", data: { name: "Alpha", email: "alpha@example.test", generationNumber: "G3-001", familyLine: "Line A",
        address: "Full multiline address", financialNotes: "=SUM(1,2)", ssn: "NEVER_EXPORT_RAW" } },
      { id: "b", ssnLast4: null, data: { name: "Beta", generationNumber: "G3-002" } },
    ],
    certificates: [
      cert("C-1", "a", 10, "2026-01-01", { status: "Partially Transferred", transferredQuantity: 4 }),
      cert("C-2", "b", 4, "2026-02-01", { status: "Partially Transferred", transferredQuantity: 1 }),
      cert("C-3", "a", 1, "2026-03-01"),
      cert("P-1", "a", 2, "2026-01-03"),
    ],
    transfers: [transfer("C-1", "C-2", "a", "b", 4, "2026-02-01"), transfer("C-2", "C-3", "b", "a", 1, "2026-03-01")],
  };
}
const run = (type: ReportType, source = fixture(), input = {}) => buildReport(type, source, input, "Administrator Example", now);
test("cap table has the example's five tabs and conserves transferred shares", () => {
  const report = run("detailed-cap-table");
  assert.deepEqual(report.sheets.map(s => s.name), ["Summary", "Ownership", "C-Common", "PS-Preferred", "Voting Ownership"]);
  assert.equal(report.sheets[0].rows[2][2], 12);
  assert.deepEqual(report.sheets[1].rows.map(r => [r[1], r[3], r[4], r[5]]), [["Alpha", 7, 2, 9], ["Beta", 3, 0, 3]]);
  assert.equal(report.sheets[0].rows[0][1], null); // no invented authorization
  assert.equal(report.sheets[4].rows[0][2], null); // no assumed votes
});
test("as-of cap table reconstructs balances, not current transferred quantities", () => {
  const report = run("detailed-cap-table", fixture(), { asOfDate: "2026-01-10" });
  assert.equal(report.sheets[0].rows[2][2], 12);
  assert.deepEqual(report.sheets[1].rows.map(r => r[5]), [12, 0]);
  const common = report.sheets[2];
  assert.equal(common.rows.length, 1);
  assert.equal(common.rows[0][5], 10);
  assert.equal(common.rows[0][common.columns.findIndex(c => c.label === "Shares Transferred")], 0);
  assert.equal(common.rows[0].at(-1), "Outstanding");
});
test("transaction report counts transfer receipts once and has correct per-person running balances", () => {
  const report = run("shareholder-transactions");
  const rows = report.sheets[0].rows;
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.filter(r => r[0] === "Alpha").map(r => r[4]), [10, 12, 8, 9]);
  assert.deepEqual(rows.filter(r => r[0] === "Beta").map(r => r[4]), [4, 3]);
  assert.ok(rows.filter(r => r[0] === "Beta").every(r => String(r[2]).includes("transferred")));
  assert.equal(run("shareholder-transactions", fixture(), { shareholderId: "b", asOfDate: "2026-02-15" }).sheets[0].rows.length, 1);
});
test("information export masks SSNs, maps External ID and does not infer address components", () => {
  const report = run("shareholder-information");
  const first = report.sheets[0].rows[0];
  assert.equal(first[1], "G3-001");
  assert.equal(first[4], null);
  assert.equal(first[6], null);
  assert.equal(first[10], "***-**-1234");
  assert.ok(!JSON.stringify(report).includes("NEVER_EXPORT_RAW"));
});
test("generated XLSX opens with correct sheets, metadata, dates, number formats and literal formula-like text", async () => {
  const cap = new ExcelJS.Workbook();
  await cap.xlsx.load(Uint8Array.from(await reportWorkbook(run("detailed-cap-table"))).buffer);
  assert.equal(cap.worksheets.length, 6);
  assert.equal(cap.creator, "Administrator Example");
  assert.equal(cap.getWorksheet("Summary")!.getCell("C7").value, 12);
  assert.equal(cap.getWorksheet("Summary")!.getCell("F5").numFmt, "0.0000%");
  assert.ok(cap.getWorksheet("C-Common")!.getCell("D5").value instanceof Date);
  const info = new ExcelJS.Workbook();
  await info.xlsx.load(Uint8Array.from(await reportWorkbook(run("shareholder-information"))).buffer);
  assert.equal(info.getWorksheet("Shareholders")!.getCell("L5").value, "=SUM(1,2)");
  assert.equal(info.getWorksheet("Shareholders")!.getCell("L5").type, ExcelJS.ValueType.String);
  assert.equal(info.getWorksheet("Shareholders")!.getCell("K5").value, "***-**-1234");
  assert.ok(!JSON.stringify(info.getWorksheet("Shareholders")!.getSheetValues()).includes("NEVER_EXPORT_RAW"));
});
test("large recorded consideration is preserved exactly and zero price remains zero", () => {
  const source = fixture();
  source.transfers[0].pricePerShare = "100000000000000001.123456";
  let report = run("detailed-cap-table", source);
  const index = report.sheets[2].columns.findIndex(c => c.label === "Amount Paid for Transfer");
  assert.equal(report.sheets[2].rows[0][index], "400000000000000004.493824");
  source.transfers[0].pricePerShare = "0";
  report = run("detailed-cap-table", source);
  assert.equal(report.sheets[2].rows[0][index], 0);
});
test("empty reports contain no NaN or fabricated holdings", async () => {
  const source: ReportSource = { holders: [], certificates: [], transfers: [] };
  for (const type of ["detailed-cap-table", "shareholder-information", "shareholder-transactions"] as const) {
    const report = run(type, source);
    assert.ok(!JSON.stringify(report).includes("NaN"));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(await reportWorkbook(report)).buffer);
    assert.ok(book.getWorksheet("Notes"));
  }
});
test("invalid dates, unsupported filters and unknowable historical dates fail explicitly", () => {
  assert.throws(() => run("detailed-cap-table", fixture(), { asOfDate: "2026-02-31" }), ReportError);
  assert.throws(() => run("detailed-cap-table", fixture(), { asOfDate: "2100-01-01" }), ReportError);
  assert.throws(() => run("shareholder-information", fixture(), { asOfDate: "2026-01-01" }), ReportError);
  assert.throws(() => run("detailed-cap-table", fixture(), { shareholderId: "a" }), ReportError);
  assert.throws(() => run("shareholder-transactions", fixture(), { shareholderId: "missing" }), ReportError);
  const source = fixture();
  source.certificates[0].issueDate = null;
  assert.throws(() => run("detailed-cap-table", source, { asOfDate: "2026-02-15" }), ReportError);
  assert.ok(run("detailed-cap-table", source).notes.some(n => n.includes("Undated")));
});
test("unsafe totals are rejected rather than silently rounded", () => {
  const source = fixture();
  source.certificates[0].quantity = Number.MAX_SAFE_INTEGER;
  assert.throws(() => run("detailed-cap-table", source), ReportError);
});
test("missing transfer history or inconsistent effective dates cannot silently misstate ownership", () => {
  const missing = fixture();
  missing.transfers.pop();
  assert.throws(() => run("detailed-cap-table", missing), ReportError);
  const dated = fixture();
  dated.certificates[1].issueDate = "2026-01-15";
  assert.throws(() => run("shareholder-transactions", dated), ReportError);
  assert.doesNotThrow(() => run("shareholder-information", missing));
});
