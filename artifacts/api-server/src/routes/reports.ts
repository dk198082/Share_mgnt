import { Router, type IRouter } from "express";
import { db, shareholdersTable, certificatesTable, shareTransfersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ExportShareholderReportBody } from "@workspace/api-zod";
import { requireEmployee, requireAdmin } from "../middlewares/employee";
import { auditContext } from "../lib/audit";
import { buildReport, ReportError, reportTypes, type ReportType } from "../lib/report-data";
import { reportWorkbook } from "../lib/report-workbook";

const router: IRouter = Router();
router.use("/reports", (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  res.set("X-Content-Type-Options", "nosniff");
  next();
}, requireEmployee, requireAdmin);
router.post("/reports/:reportType/export", async (req, res, next) => {
  try {
    const type = req.params.reportType as ReportType;
    if (!reportTypes.includes(type)) throw new ReportError("Unknown report.", 404);
    const parsed = ExportShareholderReportBody.strict().safeParse(req.body);
    if (!parsed.success)
      throw new ReportError("Provide a valid report date and optional shareholder.");
    const input = parsed.data;
    const source = await db.transaction(async tx => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
      const [holders, certificates, transfers] = await Promise.all([
        tx.select({ id: shareholdersTable.id, data: shareholdersTable.data, ssnLast4: shareholdersTable.ssnLast4 }).from(shareholdersTable),
        tx.select().from(certificatesTable),
        tx.select().from(shareTransfersTable),
      ]);
      return { holders, certificates, transfers };
    });
    const report = buildReport(type, source, input, auditContext.getStore()?.name ?? "Administrator");
    const buffer = await reportWorkbook(report);
    res.set("Content-Disposition", `attachment; filename="${type}-${report.asOfDate}.xlsx"`);
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(buffer);
  } catch (error) {
    if (error instanceof ReportError) res.status(error.status).json({ error: error.message });
    else next(error);
  }
});
export default router;
