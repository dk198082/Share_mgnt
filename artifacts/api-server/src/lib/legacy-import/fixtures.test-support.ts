import ExcelJS from "exceljs";
import type { SourceFile } from "./workbooks";

type Rows = Record<string, unknown>[];
async function workbook(name: string, sheets: Record<string, Rows>): Promise<SourceFile> {
  const book = new ExcelJS.Workbook();
  book.created = new Date("2020-01-01T00:00:00Z");
  book.modified = new Date("2020-01-01T00:00:00Z");
  for (const [sheetName, rows] of Object.entries(sheets)) {
    const sheet = book.addWorksheet(sheetName);
    sheet.addRow(["Synthetic export"]);
    const headings = Object.keys(rows[0] ?? {});
    sheet.addRow(headings);
    rows.forEach(row => sheet.addRow(headings.map(h => row[h] as ExcelJS.CellValue)));
  }
  return { name, base64: Buffer.from(await book.xlsx.writeBuffer()).toString("base64") };
}
export function syntheticRows() {
  return {
    people: [
      { Name: "Synthetic First", "External ID": "SYN-1", Email: "", SSN: "", Address: "", City: "", State: "", "Zip Code": "", Country: "", Comments: "Unclassified note" },
      { Name: "Synthetic Second", "External ID": "SYN-2", Email: "", SSN: "", Address: "", City: "", State: "", "Zip Code": "", Country: "", Comments: "" },
    ] as Rows,
    rawPeople: [{ Id: "owner1", ExternalId: "SYN-1" }, { Id: "owner2", ExternalId: "SYN-2" }] as Rows,
    securities: [
      { Id: "sec1", CertificateId: "C-9001", StakeholderId: "owner1", SecurityClassId: "common", IssuedAmount: 10.25, OutstandingAmount: 7.75, CancelledAmount: 2.5, CancellationReason: "TRANSFER", RepurchasedAmount: 0, SharesRepurchased: 0, Status: "OUTSTANDING", IssueDate: "1940-01-01" },
      { Id: "sec2", CertificateId: "C-9002", StakeholderId: "owner2", SecurityClassId: "common", IssuedAmount: 2.5, OutstandingAmount: 2.5, CancelledAmount: 0, CancellationReason: "", RepurchasedAmount: 0, SharesRepurchased: 0, Status: "OUTSTANDING", IssueDate: "1950-01-01" },
      { Id: "sec3", CertificateId: "P-9001", StakeholderId: "owner1", SecurityClassId: "preferred", IssuedAmount: 0.01, OutstandingAmount: 0.01, CancelledAmount: 0, CancellationReason: "", RepurchasedAmount: 0, SharesRepurchased: 0, Status: "OUTSTANDING", IssueDate: "1941-01-01" },
    ] as Rows,
    common: [
      { "Certificate ID": "C-9001", "Stakeholder External ID": "SYN-1", "Issue Date": "1940-01-01", "Shares Issued": 10.25, "Shares Outstanding": 7.75, "Shares Transferred": 2.5, "Shares Cancelled": 0, "Shares Repurchased": 0, "Vesting Schedule": "Synthetic schedule" },
      { "Certificate ID": "C-9002", "Stakeholder External ID": "SYN-2", "Issue Date": "1950-01-01", "Shares Issued": 2.5, "Shares Outstanding": 2.5, "Shares Transferred": 0, "Shares Cancelled": 0, "Shares Repurchased": 0, "Vesting Schedule": "Synthetic schedule" },
    ] as Rows,
    preferred: [{ "Certificate ID": "P-9001", "Stakeholder External ID": "SYN-1", "Issue Date": "1941-01-01", "Shares Issued": 0.01, "Shares Outstanding": 0.01, "Shares Transferred": 0, "Shares Cancelled": 0, "Shares Repurchased": 0, "Vesting Schedule": "Synthetic schedule" }] as Rows,
    ownership: [{ "Stakeholder External ID": "SYN-1", Common: 7.75, Preferred: 0.01 }, { "Stakeholder External ID": "SYN-2", Common: 2.5, Preferred: 0 }] as Rows,
    transfers: [{ legacy_transfer_id: "SYN-T-1", recipient_certificate_id: "C-9002", transfer_date: "1950-01-01", quantity: 2.5, evidence_reference: "Verified synthetic movement fixture", reason: "Gift", historical_price_per_share: "" }] as Rows,
    allocations: [{ legacy_transfer_id: "SYN-T-1", source_certificate_id: "C-9001", quantity: 2.5 }] as Rows,
  };
}
export type FixtureRows = ReturnType<typeof syntheticRows>;
export async function fixtureFiles(rows = syntheticRows(), history = false) {
  const files = [
    await workbook("people.xlsx", { Stakeholders: rows.people }),
    await workbook("raw.xlsx", { StakeholderCompanies: rows.rawPeople, Securities: rows.securities, ShareClasses: [{ Id: "common", Name: "Common" }, { Id: "preferred", Name: "Preferred" }] }),
    await workbook("cap.xlsx", { "C-Common": rows.common, "PS-Preferred": rows.preferred, Ownership: rows.ownership }),
  ];
  if (history) files.push(await workbook("history.xlsx", { Transfers: rows.transfers, Transfer_Allocations: rows.allocations }));
  return files;
}
