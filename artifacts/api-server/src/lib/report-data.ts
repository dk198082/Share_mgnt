import type { CertificateRow, ShareTransferRow, ShareholderRow } from "@workspace/db";
import { transferSources } from "./transfers";

export const reportTypes = ["detailed-cap-table", "shareholder-information", "shareholder-transactions"] as const;
export type ReportType = typeof reportTypes[number];
export type ReportHolder = Pick<ShareholderRow, "id" | "data" | "ssnLast4">;
type ReportTransfer = Omit<ShareTransferRow, "sources"> & { sources?: ShareTransferRow["sources"] };
export type ReportSource = { holders: ReportHolder[]; certificates: CertificateRow[]; transfers: ReportTransfer[] };
export type ReportCell = string | number | null;
export type ReportColumn = { label: string; format?: "number" | "percent" | "money" | "date" };
export type ReportSheet = { name: string; columns: ReportColumn[]; rows: ReportCell[][] };
export type Report = { title: string; asOfDate: string; generatedAt: Date; generatedBy: string; notes: string[]; sheets: ReportSheet[] };
export class ReportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const text = (holder: ReportHolder | undefined, key: string): string =>
  typeof holder?.data[key] === "string" ? holder.data[key] as string : "";
const columns = (labels: string[], formats: Record<string, ReportColumn["format"]> = {}): ReportColumn[] =>
  labels.map(label => ({ label, format: formats[label] }));
const ratio = (part: number, total: number) => total ? part / total : 0;
const externalId = (holder: ReportHolder | undefined) => text(holder, "generationNumber");
const unique = (items: string[]) => [...new Set(items)].join("; ");
const joinDates = (items: string[]) => unique(items.sort());
const sum = (values: number[]) => values.reduce((total, value) => {
  const result = total + value;
  if (!Number.isSafeInteger(result)) throw new ReportError("Report totals exceed the exact numeric range. Narrow the report before exporting.");
  return result;
}, 0);
// Exact consideration arithmetic; Excel cannot preserve >15 significant digits.
function consideration(transfers: ReportTransfer[]): string | number | null {
  if (!transfers.length || transfers.some(t => t.pricePerShare === null)) return null;
  let total = 0n;
  for (const t of transfers) {
    const [whole, fraction = ""] = t.pricePerShare!.split(".");
    total += (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))) * BigInt(t.quantity);
  }
  const value = `${total / 1_000_000n}.${String(total % 1_000_000n).padStart(6, "0")}`;
  const [whole, fraction] = value.split(".");
  return (whole.replace(/^0+/, "") + fraction.replace(/0+$/, "")).length > 15 ? value : Number(value);
}
function numericPrice(value: string | null): ReportCell {
  if (value === null) return null;
  return value.replace(/^0+|[.]/g, "").length > 15 ? value : Number(value);
}

export function buildReport(
  type: ReportType,
  source: ReportSource,
  input: { asOfDate?: string; shareholderId?: string },
  generatedBy: string,
  generatedAt = new Date(),
): Report {
  const today = generatedAt.toISOString().slice(0, 10);
  const date = input.asOfDate ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date > today)
    throw new ReportError("Choose a valid report date on or before today.");
  if (input.shareholderId && type !== "shareholder-transactions")
    throw new ReportError("The shareholder filter is available for the Transaction Report only.");
  if (input.shareholderId && !source.holders.some(h => h.id === input.shareholderId))
    throw new ReportError("The selected shareholder no longer exists.", 404);
  if (type === "shareholder-information" && date !== today)
    throw new ReportError("Shareholder Information uses current personal records. Choose today's date.");
  const holders = [...source.holders].sort((a, b) => text(a, "name").localeCompare(text(b, "name")) || a.id.localeCompare(b.id));
  const byHolder = new Map(holders.map(h => [h.id, h]));
  const selected = holders.filter(h => !input.shareholderId || h.id === input.shareholderId);
  const notes = [
    "Generated from a single read-only, consistent database snapshot. Example workbook data is not included.",
    "Ledger dates are effective issue/transfer dates, using all transactions recorded at generation time. Pending and rejected approval requests are excluded.",
    "Shareholder names, contact information, Family Line, External ID and notes are current profile values, not historical personal information. Transaction counterparty names are retained as recorded.",
    "The stored Generation number (External ID) is used as External ID. A separate Generation value is not stored.",
    "SSNs are masked to their last four digits. Encrypted SSNs are not read or decrypted for reports.",
    "Fully diluted totals include recorded Common and Preferred shares one-for-one only. No option pool, conversion ratios or other dilutive securities are configured.",
    "Blank means not recorded or not supported, not zero. Authorized limits, available authorized shares, voting rights, capital contributions, options, award plans and detailed vesting quantities are not tracked.",
    "The full stored Address is exported in Address. Separate city, state, postal code and country fields are not stored or inferred. Comments contains Financial notes.",
    "Certificate Price per Share, where present, is the recorded incoming transfer price, not today's Settings price or an original subscription price. Transfer consideration is not company capital contribution.",
    "Voting Ownership lists shareholders but leaves votes/percentages blank because voting rights are not configured.",
    "Amounts exceeding Excel's 15-digit numeric precision are exported as exact text to avoid rounding.",
  ];
  const report: Report = {
    title: type === "detailed-cap-table" ? "Detailed Cap Table" : type === "shareholder-information" ? "Shareholder Information Report" : "Shareholder Transaction Report",
    asOfDate: date, generatedAt, generatedBy, notes, sheets: [],
  };
  if (source.holders.some(h => text(h, "name").startsWith("PILOT — "))) {
    notes.push("This dataset contains fictional PILOT shareholders and holdings. Their shares are included in applicable totals; these reports are for pilot testing, not official company financial reporting.");
  }
  if (type === "shareholder-information") {
    report.sheets.push({
      name: "Shareholders",
      columns: columns(["Name", "External ID", "Email", "Family Line", "Generation", "Address", "City", "Zip Code", "State", "Country", "SSN", "Comments"]),
      rows: holders.map(h => [text(h, "name"), externalId(h), text(h, "email"), text(h, "familyLine"), null,
        text(h, "address"), null, null, null, null, h.ssnLast4 ? `***-**-${h.ssnLast4.slice(-4)}` : "", text(h, "financialNotes")]),
    });
    return report;
  }
  const certificateIndex = new Map(source.certificates.map(c => [c.id, c]));
  const allocationQuantity = (t: ReportTransfer, id: string) => transferSources(t).find(s => s.certificateId === id)?.quantity ?? 0;
  if (source.certificates.some(c => c.transferredQuantity !== sum(source.transfers.map(t => allocationQuantity(t, c.id)))))
    throw new ReportError("Certificate balances do not reconcile with transfer history. Resolve missing or inconsistent transfer records before running a ledger report.");
  if (source.transfers.some(t => {
    const to = certificateIndex.get(t.recipientCertificateId), allocations = transferSources(t);
    return !to || to.quantity !== t.quantity || to.shareholderId !== t.recipientId || to.shareClass !== t.shareClass ||
      sum(allocations.map(s => s.quantity)) !== t.quantity || new Set(allocations.map(s => s.certificateId)).size !== allocations.length ||
      !allocations.some(s => s.certificateId === t.sourceCertificateId) ||
      allocations.some(s => {
        const from = certificateIndex.get(s.certificateId);
        return !from || s.quantity <= 0 || from.shareholderId !== t.originatorId || from.shareClass !== t.shareClass ||
          (from.issueDate && from.issueDate > t.transferDate);
      }) || (to.issueDate && to.issueDate !== t.transferDate);
  }))
    throw new ReportError("Certificate issue dates and transfer dates do not reconcile. Resolve the dated ledger before running a financial report.");
  const relevantCertificates = source.certificates.filter(c => !input.shareholderId || c.shareholderId === input.shareholderId);
  if (date !== today && relevantCertificates.some(c => !c.issueDate || c.status === "Cancelled"))
    throw new ReportError("A historical report cannot be reconstructed reliably: some certificates lack an issue date or a recorded cancellation date. Choose today's date.");
  const certificates = source.certificates.filter(c => !c.issueDate || c.issueDate <= date)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber || a.id.localeCompare(b.id));
  const included = new Set(certificates.map(c => c.id));
  const transfers = source.transfers.filter(t => t.transferDate <= date && transferSources(t).every(s => included.has(s.certificateId)));
  if (relevantCertificates.some(c => !c.issueDate))
    notes.push("Undated issuances are included in today's balances; their effective timing is unknown. The transaction report lists these as undated opening issues, not as dated grants.");
  if (relevantCertificates.some(c => c.status === "Cancelled"))
    notes.push("Cancelled certificates have zero current outstanding shares. Cancellation dates are not recorded; today's transaction report includes explicit undated cancellation adjustments after dated events.");
  // Certificate-level views use each source's allocation; shareholder events
  // below retain one aggregate transfer so the recipient is never counted twice.
  const outgoing = (id: string) => transfers.filter(t => allocationQuantity(t, id) > 0).map(t => ({ ...t, quantity: allocationQuantity(t, id) }));
  const remaining = (c: CertificateRow) => c.status === "Cancelled" ? 0 : c.quantity - sum(outgoing(c.id).map(t => t.quantity));
  if (certificates.some(c => remaining(c) < 0))
    throw new ReportError("The dated ledger contains transfers exceeding a certificate's issued shares. Correct the ledger before running this report.");
  const common = sum(certificates.filter(c => c.shareClass === "Common").map(remaining));
  const preferred = sum(certificates.filter(c => c.shareClass === "Preferred").map(remaining));
  const total = sum([common, preferred]);
  const holding = (id: string, shareClass: string) => sum(certificates.filter(c => c.shareholderId === id && c.shareClass === shareClass).map(remaining));
  if (type === "detailed-cap-table") {
    const summaryColumns = columns(["Share Class", "Authorized", "Issued and Outstanding", "Available Shares", "Capital Contribution",
      "Issued and Outstanding % Ownership", "Stock Options", "Fully Diluted", "Fully Diluted % Ownership"],
      { "Issued and Outstanding % Ownership": "percent", "Fully Diluted % Ownership": "percent" });
    report.sheets.push({ name: "Summary", columns: summaryColumns, rows: [
      ["Common", null, common, null, null, ratio(common, total), null, common, ratio(common, total)],
      ["Preferred", null, preferred, null, null, ratio(preferred, total), null, preferred, ratio(preferred, total)],
      ["Total", null, total, null, null, total ? 1 : 0, null, total, total ? 1 : 0],
    ] });
    const ownershipRows = holders.map(h => {
      const c = holding(h.id, "Common"), p = holding(h.id, "Preferred"), n = c + p;
      return [externalId(h), text(h, "name"), null, c, p, n, ratio(n, total), null, n, ratio(n, total)];
    });
    report.sheets.push({ name: "Ownership", columns: columns(["Shareholder External ID", "Shareholder", "Shareholder Type", "Common", "Preferred",
      "Issued and Outstanding", "Issued and Outstanding % Ownership", "Awards Issued Outside of a Plan", "Fully Diluted", "Fully Diluted % Ownership"],
      { "Issued and Outstanding % Ownership": "percent", "Fully Diluted % Ownership": "percent" }), rows: ownershipRows });
    const certificateColumns = columns(["Certificate ID", "Shareholder Name", "Shareholder External ID", "Issue Date", "Shares Issued", "Shares Outstanding",
      "Ownership Percentage", "Price Per Share", "Vesting Start Date", "Vesting Schedule", "Shares Vested", "Shares Unvested", "Capital Contribution",
      "Debt Cancelled", "Value of IP Contribution", "Last Repurchase Date", "Shares Subject to Repurchase (Unvested)", "Shares Repurchased", "Repurchase Date",
      "Amount Paid for Repurchase", "Shares Transferred", "Transfer Date", "Transferred To", "Amount Paid for Transfer", "Transfer Reason", "Shares Cancelled",
      "Cancellation Date", "Cancellation Reason", "Converted From", "Conversion Date", "Source", "Federal Exemption", "State Exemption",
      "Domicile - Region of Residence", "Rule 144 Date", "Board Approval Date", "Equity Plan Name", "Acceleration", "Acceleration Provisions", "Documents", "Comments", "Certificate Status"],
      { "Issue Date": "date", "Ownership Percentage": "percent", "Price Per Share": "money", "Amount Paid for Transfer": "money" });
    for (const shareClass of ["Common", "Preferred"] as const) {
      report.sheets.push({
        name: shareClass === "Common" ? "C-Common" : "PS-Preferred", columns: certificateColumns,
        rows: certificates.filter(c => c.shareClass === shareClass).map(c => {
          const h = byHolder.get(c.shareholderId), out = outgoing(c.id);
          const incoming = transfers.find(t => t.recipientCertificateId === c.id);
          const transferred = sum(out.map(t => t.quantity)), balance = remaining(c);
          const status = c.status === "Cancelled" ? "Cancelled" : balance === 0 ? "Transferred" : transferred ? "Partially Transferred" : "Outstanding";
          const values: Record<string, ReportCell> = {
            "Certificate ID": c.id, "Shareholder Name": text(h, "name"), "Shareholder External ID": externalId(h), "Issue Date": c.issueDate,
            "Shares Issued": c.quantity, "Shares Outstanding": balance, "Ownership Percentage": ratio(balance, shareClass === "Common" ? common : preferred),
            "Price Per Share": incoming ? numericPrice(incoming.pricePerShare) : null, "Vesting Schedule": c.vestingSchedule,
            "Shares Transferred": transferred, "Transfer Date": joinDates(out.map(t => t.transferDate)),
            "Transferred To": unique(out.map(t => `${t.recipientCertificateId} (${t.recipientName})`)),
            "Amount Paid for Transfer": consideration(out), "Transfer Reason": unique(out.map(t => t.reason ?? "")),
            "Shares Cancelled": c.status === "Cancelled" ? c.quantity - transferred : 0, "Certificate Status": status,
          };
          return certificateColumns.map(col => values[col.label] ?? null);
        }),
      });
    }
    report.sheets.push({ name: "Voting Ownership", columns: columns(["Shareholder Name", "Shareholder External ID", "Votes", "Voting Ownership Percentage"]),
      rows: holders.map(h => [text(h, "name"), externalId(h), null, null]) });
    return report;
  }
  type Event = { holderId: string; date: string; order: string; delta: number; event: string; shareClass: string; source: string; destination: string; counterparty: string; reason: string; price: ReportCell };
  const events: Event[] = [];
  const transferCreatedCertificates = new Set(source.transfers.map(t => t.recipientCertificateId));
  for (const c of certificates) {
    if (!transferCreatedCertificates.has(c.id))
      events.push({ holderId: c.shareholderId, date: c.issueDate ?? "", order: `0-${c.createdAt.toISOString()}-${c.id}`, delta: c.quantity,
        event: c.issueDate ? `${c.quantity} ${c.shareClass} shares issued` : `${c.quantity} ${c.shareClass} shares — undated opening issue`,
        shareClass: c.shareClass, source: "", destination: c.id, counterparty: "", reason: "", price: null });
  }
  for (const t of transfers) {
    const sourceSequence = source.certificates.find(c => c.id === t.sourceCertificateId)?.sequenceNumber ?? 0;
    const base = { date: t.transferDate, order: `1-${t.createdAt.toISOString()}-${String(sourceSequence).padStart(12, "0")}-${t.id}`, shareClass: t.shareClass,
      source: transferSources(t).map(s => `${s.certificateId} (${s.quantity})`).join("; "), destination: t.recipientCertificateId, reason: t.reason ?? "", price: numericPrice(t.pricePerShare) };
    events.push({ ...base, holderId: t.originatorId, delta: -t.quantity, event: `${t.quantity} ${t.shareClass} shares transferred out`, counterparty: t.recipientName });
    events.push({ ...base, holderId: t.recipientId, delta: t.quantity, event: `${t.quantity} ${t.shareClass} shares transferred in`, counterparty: t.originatorName });
  }
  for (const c of certificates.filter(c => c.status === "Cancelled")) {
    const amount = c.quantity - sum(outgoing(c.id).map(t => t.quantity));
    events.push({ holderId: c.shareholderId, date: "undated", order: c.id, delta: -amount, event: "Cancellation — effective date not recorded",
      shareClass: c.shareClass, source: c.id, destination: "", counterparty: "", reason: "", price: null });
  }
  const rows: ReportCell[][] = [];
  for (const holder of selected) {
    let balance = 0;
    for (const event of events.filter(e => e.holderId === holder.id).sort((a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order))) {
      balance = sum([balance, event.delta]);
      rows.push([text(holder, "name"), event.date === "undated" ? null : event.date || null, event.event, event.delta, balance, balance,
        event.shareClass, event.source, event.destination, event.counterparty, event.reason, event.price]);
    }
  }
  report.sheets.push({ name: "Transactions", columns: columns(["Shareholder Name", "Date", "Event", "Share Change", "Shares", "Fully Diluted Total",
    "Share Class", "Source Certificate", "Recipient Certificate", "Counterparty", "Transfer Reason", "Price Per Share"], { Date: "date", "Price Per Share": "money" }), rows });
  notes.push("Shares and Fully Diluted Total are running balances per shareholder, across both share classes. Transfer-created certificates are transfer-in events, not additional grants.");
  notes.push("Events on the same effective date list original issuances first, then transfers in recorded timestamp order; this is a reporting order, not an asserted intraday effective time.");
  return report;
}
