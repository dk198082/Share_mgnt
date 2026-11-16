import type { LegacyImportBalance, LegacyImportCounts, LegacyImportIssue } from "@workspace/api-zod";
import { parseShareQuantity, shareUnits, sumShares, subtractShares } from "@workspace/share-quantities";
import { CertificateError } from "../certificates";
import { encryptSsn } from "../ssn";
import { digest, text, records, oneSheet, type Row, type Sheet } from "./workbooks";

export const MAPPING_VERSION = "pulley-profile-scoped-sample-2";
export type Person = { id: string; externalId: string; data: Record<string, unknown>; ssnEncrypted: string | null; ssnLast4: string | null };
export type Certificate = {
  id: string; sequenceNumber: number; shareholderId: string; shareClass: "Common" | "Preferred";
  quantity: number; transferredQuantity: number; issueDate: string; vestingSchedule: string;
  status: "Outstanding" | "Partially Transferred" | "Transferred" | "Cancelled";
  legacyId: string;
};
export type Transfer = {
  id: string; legacyId: string; sourceCertificateId: string; sources: { certificateId: string; quantity: number }[];
  recipientCertificateId: string; originatorId: string; recipientId: string; originatorName: string; recipientName: string;
  shareClass: "Common" | "Preferred"; quantity: number; transferDate: string; reason: string; pricePerShare: string | null;
};
export type Plan = { people: Person[]; certificates: Certificate[]; transfers: Transfer[] };
export type Assessment = { plan: Plan; issues: LegacyImportIssue[]; balances: LegacyImportBalance[]; counts: LegacyImportCounts };
const totalRow = (v: unknown) => /^(total|grand total)$/i.test(text(v));
const personId = (key: string, sampleOnly: boolean) => `${sampleOnly ? "legacy-sample" : "legacy-shareholder"}-${digest(key).slice(0, 24)}`;

export function quantity(v: unknown, allowZero = true): number {
  if (allowZero && /^0(?:\.0{1,2})?$/.test(text(v))) return 0;
  const parsed = parseShareQuantity(text(v));
  if (parsed === null || (!allowZero && parsed === 0)) throw new CertificateError(400, "Quantity must be nonnegative, within range, and have at most two decimals (positive for original shares and transfers).");
  return parsed;
}
export function calendarDate(v: unknown): string {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : text(v);
  const date = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s < "0001-01-01" || s > "9999-12-31" ||
    !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== s)
    throw new CertificateError(400, "Use a valid calendar date; historical dates are supported. A missing date is not replaced with today.");
  return s;
}
export const outstanding = (c: Certificate) => c.status === "Cancelled" ? 0 : subtractShares(c.quantity, c.transferredQuantity);

export function convert(sheets: Sheet[], mode: "preview" | "azure" = "preview"): Assessment {
  const sampleOnly = mode === "preview";
  const issues: LegacyImportIssue[] = [], balances: LegacyImportBalance[] = [];
  const plan: Plan = { people: [], certificates: [], transfers: [] };
  const issue = (severity: "error" | "warning", code: string, location: string, message: string) => issues.push({ severity, code, location, message });
  const attempt = (row: Row, fn: () => void) => {
    try { fn(); } catch (error) {
      if (!(error instanceof CertificateError)) throw error;
      issue("error", "INVALID_ROW", row._location, error.message);
    }
  };
  const peopleRows = records(oneSheet(sheets, "Stakeholders", true)!, ["Name", "External ID"]);
  const rawPeople = records(oneSheet(sheets, "StakeholderCompanies", true)!, ["Id", "ExternalId"]);
  const securities = records(oneSheet(sheets, "Securities", true)!, ["Id", "CertificateId", "StakeholderId"]);
  const classes = records(oneSheet(sheets, "ShareClasses", true)!, ["Id", "Name"]);
  const byExternal = new Map<string, Person>(), rawOwners = new Map<string, string>();
  for (const row of peopleRows) {
    if (totalRow(row["External ID"]) || totalRow(row.Name)) continue;
    attempt(row, () => {
      const key = text(row["External ID"]), name = text(row.Name), email = text(row.Email);
      const familyLine = text(row.Comments);
      if (!key || !name) throw new CertificateError(400, "A shareholder needs an External ID and name.");
      if (byExternal.has(key)) throw new CertificateError(400, "Duplicate shareholder External ID.");
      if (name.length > 230 || key.length > 100 || email.length > 320 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
        throw new CertificateError(400, "Shareholder name, External ID or email is invalid or too long.");
      if (familyLine.length > 200) throw new CertificateError(400, "Comments mapped to Family line must be at most 200 characters; values are not truncated.");
      const ssn = text(row.SSN).replace(/[-\s]/g, "");
      if (ssn && !/^\d{9}$/.test(ssn)) throw new CertificateError(400, "SSN must be blank or nine digits; protected values are not shown in this report.");
      const person: Person = {
        id: personId(key, sampleOnly), externalId: key,
        ssnEncrypted: ssn ? encryptSsn(ssn) : null, ssnLast4: ssn ? ssn.slice(-4) : null,
        data: {
          name: sampleOnly ? `SAMPLE — ${name}` : name, email, dateOfBirth: "", dateOfPassing: "", phone: "", familyLine,
          generationNumber: key, address: ["Address", "City", "State", "Zip Code", "Country"].map(k => text(row[k])).filter(Boolean).join(", "),
          financialNotes: [sampleOnly ? "ANONYMIZED LEGACY SAMPLE — not the production ledger." : "", text(row.Comments)].filter(Boolean).join("\n"),
          picturePath: "", documents: [],
          legacyImport: { externalId: key, mappingVersion: MAPPING_VERSION, sampleOnly },
        },
      };
      plan.people.push(person); byExternal.set(key, person);
    });
  }
  if (!plan.people.length) issue("error", "NO_PROFILES", "Stakeholders", "No valid shareholder profiles were supplied.");
  for (const row of rawPeople) {
    const id = text(row.Id), ext = text(row.ExternalId);
    if (!byExternal.has(ext)) continue;
    if (!id || rawOwners.has(id) || [...rawOwners.values()].includes(ext)) {
      issue("error", "OWNER_CROSSWALK", row._location, "The technical owner ID / External ID crosswalk must be one-to-one."); continue;
    }
    rawOwners.set(id, ext);
    const source = peopleRows.find(r => text(r["External ID"]) === ext);
    if (source && ["Email", "City", "State"].some(k => text(source[k]) && text(row[k]) && text(source[k]) !== text(row[k])))
      issue("warning", "PROFILE_SOURCE_PRIORITY", row._location, "Profile exports and raw metadata differ. The Shareholder Information export takes priority; no contact values are copied from the raw export.");
  }
  const classMap = new Map<string, "Common" | "Preferred">();
  for (const row of classes) {
    const name = text(row.Name).toLowerCase();
    const shareClass = name === "common" ? "Common" : name === "preferred" ? "Preferred" : null;
    if (shareClass) {
      if (classMap.has(text(row.Id))) issue("error", "DUPLICATE_CLASS", row._location, "Duplicate share class technical ID.");
      classMap.set(text(row.Id), shareClass);
    }
  }
  const detailMap = new Map<string, Row>(), detailClass = new Map<string, string>();
  for (const [sheetName, shareClass] of [["C-Common", "Common"], ["PS-Preferred", "Preferred"]]) {
    const sheet = oneSheet(sheets, sheetName);
    if (!sheet) continue;
    for (const row of records(sheet, ["Certificate ID", "Stakeholder External ID", "Shares Issued", "Shares Outstanding"])) {
      if (totalRow(row["Certificate ID"])) continue;
      const id = text(row["Certificate ID"]);
      if (detailMap.has(id)) issue("error", "DUPLICATE_DETAIL", row._location, "Duplicate certificate ID in detailed cap table.");
      detailMap.set(id, row); detailClass.set(id, shareClass);
      if (!byExternal.has(text(row["Stakeholder External ID"])))
        issue("error", "MISSING_DETAIL_OWNER", row._location, "A detailed certificate owner has no matching profile External ID.");
    }
  }
  const securityIds = new Set<string>(), labels = new Set<string>();
  let excludedSecurities = 0;
  for (const row of securities) {
    const ext = rawOwners.get(text(row.StakeholderId));
    if (!ext) { excludedSecurities++; continue; }
    attempt(row, () => {
      const id = text(row.CertificateId), legacyId = text(row.Id), shareClass = classMap.get(text(row.SecurityClassId));
      const match = /^(C|P)-([1-9]\d*)$/.exec(id);
      if (!match || !shareClass || (match[1] === "C" ? "Common" : "Preferred") !== shareClass ||
        Number(match[2]) > 2147483647) throw new CertificateError(400, "Certificate needs a valid C-n / P-n ID matching its share class, with a positive 32-bit sequence.");
      if (!legacyId || securityIds.has(legacyId) || labels.has(id)) throw new CertificateError(400, "Duplicate security ID or certificate number within the selected shareholder scope.");
      securityIds.add(legacyId); labels.add(id);
      const original = quantity(row.IssuedAmount, false), remaining = quantity(row.OutstandingAmount);
      const cancelled = quantity(row.CancelledAmount ?? 0), repurchased = quantity(row.RepurchasedAmount ?? 0);
      if (repurchased || quantity(row.SharesRepurchased ?? 0)) throw new CertificateError(400, "Repurchased shares need a separately reviewed movement mapping; they are not treated as transfers.");
      let transferred = 0;
      let status: Certificate["status"];
      const legacyStatus = text(row.Status).toUpperCase(), reason = text(row.CancellationReason).toUpperCase();
      const detail = detailMap.get(id);
      if (detail) {
        if (text(detail["Stakeholder External ID"]) !== ext || detailClass.get(id) !== shareClass ||
          quantity(detail["Shares Issued"], false) !== original || quantity(detail["Shares Outstanding"]) !== remaining ||
          calendarDate(detail["Issue Date"]) !== calendarDate(row.IssueDate))
          throw new CertificateError(400, "Raw and detailed certificate owner, class, dates or quantities disagree.");
        transferred = quantity(detail["Shares Transferred"] ?? 0);
        if (quantity(detail["Shares Repurchased"] ?? 0)) throw new CertificateError(400, "Detailed certificate contains unsupported repurchase movements.");
        if (quantity(detail["Shares Cancelled"] ?? 0) && !(remaining === 0 && transferred === 0))
          throw new CertificateError(400, "Partial cancellation cannot be represented by the current certificate ledger.");
      } else if (reason === "TRANSFER") transferred = cancelled;
      if (legacyStatus === "CANCELLED" && remaining === 0 && transferred === 0 && cancelled === original) status = "Cancelled";
      else {
        if (subtractShares(original, transferred) !== remaining) throw new CertificateError(400, "Original shares minus verified transferred shares do not equal outstanding shares.");
        status = transferred === original ? "Transferred" : transferred > 0 ? "Partially Transferred" : "Outstanding";
        if ((legacyStatus === "TRANSFERRED" && status !== "Transferred") ||
          !["OUTSTANDING", "TRANSFERRED"].includes(legacyStatus) || (cancelled && reason !== "TRANSFER"))
          throw new CertificateError(400, "Legacy status or cancellation evidence does not support the mapped certificate status.");
      }
      const schedule = detail ? text(detail["Vesting Schedule"]) : "";
      if (!schedule) issue("warning", "UNKNOWN_VESTING", row._location, "Vesting schedule was not supplied; imported text explicitly records it as unknown, not fully vested.");
      if (schedule.length > 500) throw new CertificateError(400, "Vesting schedule exceeds the application text limit.");
      plan.certificates.push({
        id, legacyId, sequenceNumber: Number(match[2]), shareholderId: byExternal.get(ext)!.id, shareClass,
        quantity: original, transferredQuantity: transferred, issueDate: calendarDate(row.IssueDate),
        status, vestingSchedule: schedule || "Legacy vesting schedule not supplied",
      });
    });
  }
  for (const [id, row] of detailMap) if (!plan.certificates.some(c => c.id === id))
    issue("error", "DETAIL_NOT_RESOLVED", row._location, "Detailed certificate could not be matched to an eligible raw certificate and owner.");
  if (!plan.certificates.length) issue("error", "NO_CERTIFICATES", "Securities", "No eligible certificates were found.");
  if (excludedSecurities) issue(sampleOnly ? "warning" : "error", sampleOnly ? "OUTSIDE_SAMPLE_SCOPE" : "UNRESOLVED_PRODUCTION_OWNERS", "Securities",
    sampleOnly
      ? `${excludedSecurities} raw securities were excluded because their owners are outside the supplied profile crosswalk. This is a scoped sample, not a full-company migration.`
      : `${excludedSecurities} raw securities have no supplied profile crosswalk. Azure import requires complete owner coverage; no partial-company import is permitted.`);

  // Reconciliation controls are evidence, never an additional holdings source.
  const ownership = sheets.filter(s => s.name === "Ownership");
  if (!ownership.length) issue("error", "MISSING_OWNERSHIP", "Ownership", "Supply an ownership report for independent balance reconciliation.");
  for (const sheet of ownership) {
    for (const row of records(sheet, ["Stakeholder External ID", "Common", "Preferred"])) {
      const ext = text(row["Stakeholder External ID"]), person = byExternal.get(ext);
      if (!person || totalRow(ext)) continue;
      for (const shareClass of ["Common", "Preferred"] as const) attempt(row, () => {
        const expected = quantity(row[shareClass]);
        const calculated = sumShares(plan.certificates.filter(c => c.shareholderId === person.id && c.shareClass === shareClass).map(outstanding));
        const matches = expected === calculated;
        balances.push({ externalId: ext, shareClass, expected, calculated, matches });
        if (!matches) issue("error", "BALANCE_MISMATCH", row._location, `${shareClass} certificate holdings do not reconcile to this ownership control.`);
      });
    }
  }
  for (const person of plan.people) {
    if (!balances.some(b => b.externalId === person.externalId)) {
      if (plan.certificates.some(c => c.shareholderId === person.id))
        issue("error", "MISSING_OWNER_CONTROL", "Ownership", "A shareholder with certificates has no ownership reconciliation row.");
      else issue("warning", "PROFILE_WITHOUT_CERTIFICATES", "Stakeholders", "A supplied profile has no certificates or ownership control in this sample; no zero-balance assertion is invented.");
    }
  }
  verifySupportingReports(sheets, plan, issue);
  parseTransfers(sheets, plan, issue);
  if (!plan.transfers.length) issue("warning", "NO_TRANSFER_EVENTS", "Transfer history",
    "No verified transaction-level transfer rows were supplied for the selected sample. Certificate balances are imported without inventing transfer events, actors, approvals or PDFs.");
  return { plan, issues, balances, counts: {
    shareholders: plan.people.length, certificates: plan.certificates.length, transfers: plan.transfers.length, excludedSecurities,
    commonShares: sumShares(plan.certificates.filter(c => c.shareClass === "Common").map(outstanding)),
    preferredShares: sumShares(plan.certificates.filter(c => c.shareClass === "Preferred").map(outstanding)),
  } };
}

type Issue = (severity: "error" | "warning", code: string, location: string, message: string) => void;
function verifySupportingReports(sheets: Sheet[], plan: Plan, issue: Issue) {
  for (const name of ["Securities Granted", "Grants Outstanding Canceled"]) {
    const sheet = oneSheet(sheets, name);
    if (!sheet) { issue("warning", "OPTIONAL_REPORT_ABSENT", name, "This supplementary report was not supplied."); continue; }
    const rows = records(sheet, ["Certificate ID", "External ID"]);
    let matched = 0;
    for (const row of rows) {
      const certificate = plan.certificates.find(c => c.id === text(row["Certificate ID"]));
      if (!certificate) continue;
      matched++;
      try {
        const person = plan.people.find(p => p.id === certificate.shareholderId)!;
        if (text(row["External ID"]) !== person.externalId) throw new Error();
        if (calendarDate(row["Grant Date"]) !== certificate.issueDate) throw new Error();
        const supplied = row["Granted / Original Target"] ?? row["Granted/Original Target"] ?? row["Granted/ Original Target"] ?? row["Amount Granted"];
        if (supplied !== undefined && supplied !== null && quantity(supplied, false) !== certificate.quantity) throw new Error();
        if (name === "Grants Outstanding Canceled" && quantity(row["Total Cancelled/Expired Quantity"] ?? row["Total Cancelled / Expired Quantity"] ?? row["Total Cancelled/ Expired Quantity"] ?? 0) > 0 &&
          certificate.status === "Outstanding") throw new Error();
      } catch {
        issue("error", "SUPPLEMENT_DISAGREES", row._location, "Supplementary grant/cancellation evidence disagrees with the selected certificate.");
      }
    }
    issue("warning", "SUPPLEMENT_COVERAGE", name, `${matched} selected certificate rows were checked against this supplementary report. Date-range reports may not include all certificates.`);
  }
}

/** Optional seventh workbook supplies explicitly reviewed history. Parent links
 * and cancellations alone never synthesize a legal transfer event. */
function parseTransfers(sheets: Sheet[], plan: Plan, issue: Issue) {
  const sheet = oneSheet(sheets, "Transfers"), allocationSheet = oneSheet(sheets, "Transfer_Allocations");
  if (!sheet && !allocationSheet) return;
  if (!sheet || !allocationSheet) {
    issue("error", "TRANSFER_SHEETS", "Transfers", "Supply both Transfers and Transfer_Allocations sheets."); return;
  }
  const rows = records(sheet, ["legacy_transfer_id", "recipient_certificate_id", "transfer_date", "quantity"]);
  const allocations = records(allocationSheet, ["legacy_transfer_id", "source_certificate_id", "quantity"]);
  const ids = new Set<string>(), children = new Set<string>(), consumed = new Map<string, bigint>();
  for (const row of rows) {
    try {
      const key = text(row.legacy_transfer_id), childId = text(row.recipient_certificate_id);
      if (!key || ids.has(key) || children.has(childId) || !text(row.evidence_reference)) throw new Error();
      ids.add(key); children.add(childId);
      const child = plan.certificates.find(c => c.id === childId);
      const parts = allocations.filter(a => text(a.legacy_transfer_id) === key);
      if (!child || !parts.length) throw new Error();
      const sources = parts.map(a => ({ certificateId: text(a.source_certificate_id), quantity: quantity(a.quantity, false) }));
      if (new Set(sources.map(s => s.certificateId)).size !== sources.length) throw new Error();
      const originals = sources.map(s => plan.certificates.find(c => c.id === s.certificateId));
      const origin = originals[0];
      const amount = quantity(row.quantity, false), date = calendarDate(row.transfer_date);
      if (!origin || amount !== child.quantity || amount !== sumShares(sources.map(s => s.quantity)) || date !== child.issueDate ||
        originals.some(c => !c || c.shareholderId !== origin.shareholderId || c.shareholderId === child.shareholderId ||
          c.shareClass !== child.shareClass || c.issueDate > date || c.status === "Cancelled")) throw new Error();
      for (const s of sources) consumed.set(s.certificateId, (consumed.get(s.certificateId) ?? 0n) + shareUnits(s.quantity));
      const from = plan.people.find(p => p.id === origin.shareholderId)!, to = plan.people.find(p => p.id === child.shareholderId)!;
      const price = text(row.historical_price_per_share);
      if (price && !/^\d{1,12}(\.\d{1,6})?$/.test(price)) throw new Error();
      plan.transfers.push({
        id: `legacy-transfer-${digest(key).slice(0, 24)}`, legacyId: key, sourceCertificateId: sources[0].certificateId, sources,
        recipientCertificateId: childId, originatorId: from.id, recipientId: to.id,
        originatorName: String(from.data.name), recipientName: String(to.data.name), shareClass: child.shareClass,
        quantity: amount, transferDate: date, reason: text(row.reason), pricePerShare: price || null,
      });
    } catch { issue("error", "INVALID_TRANSFER", row._location, "Transfer must have a unique key and recipient, a supported date/quantity, and complete same-owner/class allocations matching the certificate evidence."); }
  }
  for (const row of allocations) if (!ids.has(text(row.legacy_transfer_id)))
    issue("error", "ORPHAN_ALLOCATION", row._location, "Allocation references an unknown transfer.");
  for (const c of plan.certificates) if ((consumed.get(c.id) ?? 0n) !== shareUnits(c.transferredQuantity))
    issue("error", "INCOMPLETE_TRANSFER_COVERAGE", "Transfer_Allocations", "Explicit history must account for every verified transferred quantity in the selected certificate inventory.");
  // Each imported event must be affordable at that date, not only at cutoff.
  for (const c of plan.certificates) {
    let used = 0n;
    for (const t of [...plan.transfers].sort((a, b) => a.transferDate.localeCompare(b.transferDate))) {
      for (const s of t.sources.filter(s => s.certificateId === c.id)) {
        used += shareUnits(s.quantity);
        if (used > shareUnits(c.quantity)) issue("error", "TRANSFER_OVERSPEND", "Transfer_Allocations", "Historical transfers exceed the original source certificate quantity.");
      }
    }
  }
}
