import { Router, type IRouter } from "express";
import ExcelJS from "exceljs";
import {
  AnalyzeLegacyImportBody, CommitLegacyImportBody, GetLegacyImportStatusResponse,
  ListLegacyImportRunsResponse,
} from "@workspace/api-zod";
import { CertificateError } from "../lib/certificates";
import { requireEmployee } from "../middlewares/employee";
import { commitImport, listImports, stageImport } from "../lib/legacy-import/service";
import { importActor as actor, importAvailability, requireImportAccess } from "../lib/legacy-import/access";

const router: IRouter = Router();
router.use("/settings/data-import", requireEmployee);
router.get("/settings/data-import/status", (req, res) => {
  res.json(GetLegacyImportStatusResponse.parse(importAvailability(process.env, actor(req))));
});
router.get("/settings/data-import/runs", async (req, res): Promise<void> => {
  res.json(ListLegacyImportRunsResponse.parse(await listImports(actor(req))));
});
router.post("/settings/data-import/analyze", async (req, res): Promise<void> => {
  const mode = requireImportAccess(actor(req));
  const input = AnalyzeLegacyImportBody.strict().safeParse(req.body);
  if (!input.success || input.data.syntheticOnly !== (mode === "preview")) {
    res.status(400).json({ error: "Confirm the current environment's data boundary and select 3–7 XLSX workbooks." }); return;
  }
  res.status(201).json(await stageImport(input.data.files, actor(req)));
});
router.post("/settings/data-import/runs/:id/commit", async (req, res): Promise<void> => {
  const mode = requireImportAccess(actor(req));
  const input = CommitLegacyImportBody.strict().safeParse(req.body);
  if (!input.success || input.data.syntheticOnly !== (mode === "preview")) {
    res.status(400).json({ error: "Confirm the current environment's data boundary before committing." }); return;
  }
  const id = String(req.params.id);
  if (!/^legacy-import-[a-f0-9]{24}$/.test(id)) { res.status(400).json({ error: "Invalid import run ID." }); return; }
  res.json(await commitImport(id, actor(req), input.data.acknowledgeWarnings));
});
router.get("/settings/data-import/template", async (req, res): Promise<void> => {
  requireImportAccess(actor(req));
  const book = new ExcelJS.Workbook();
  const instructions = book.addWorksheet("Instructions");
  instructions.addRows([
    ["Optional verified transfer history — Preview synthetic data only"],
    ["Upload the original six Pulley XLSX exports directly; do not rekey their rows."],
    ["This seventh workbook is needed ONLY to supply independently verified transfer events."],
    ["Leave blank if transaction evidence is unavailable. Parent links are not sufficient evidence."],
    ["Transfers: required legacy_transfer_id, recipient_certificate_id, transfer_date (YYYY-MM-DD), quantity (>0, up to 2 decimals), evidence_reference."],
    ["Transfers: optional reason, historical_price_per_share. Never substitute current Settings prices."],
    ["Transfer_Allocations: required legacy_transfer_id, source_certificate_id, quantity (>0, up to 2 decimals)."],
    ["All sources in a batch must have one owner and share class. All verified transferred quantities must reconcile."],
    ["No source rows are included in this blank template. Do not invent historical IDs, dates, quantities or actors."],
    ["Source filenames and SHA-256 hashes, import operator/time and reconciliation are retained in run history."],
    ["This utility does not upload historical PDFs, reset data or run production imports."],
  ]);
  instructions.getColumn(1).width = 115;
  for (const [name, headings] of [
    ["Transfers", ["legacy_transfer_id", "recipient_certificate_id", "transfer_date", "quantity", "evidence_reference", "reason", "historical_price_per_share"]],
    ["Transfer_Allocations", ["legacy_transfer_id", "source_certificate_id", "quantity"]],
  ] as const) {
    const sheet = book.addWorksheet(name);
    sheet.addRow([...headings]);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.columns.forEach(column => { column.width = 28; column.numFmt = "@"; });
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF214E43" } };
  }
  res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.set("Content-Disposition", 'attachment; filename="Legacy_Transfer_History_Template.xlsx"');
  res.send(Buffer.from(await book.xlsx.writeBuffer()));
});
router.use("/settings/data-import", (error: unknown, req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  if (error instanceof CertificateError) { res.status(error.status).json({ error: error.message }); return; }
  // Do not serialize pg errors, cell values, request bodies or encrypted SSNs.
  req.log.error({ errorType: error instanceof Error ? error.name : "Error" }, "Legacy import failed");
  res.status(500).json({ error: "Import could not be completed. No partial ledger changes were saved. Check run history before retrying." });
});
export default router;
