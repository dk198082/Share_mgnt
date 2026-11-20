import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { holder, recipient, transfer, requestId, importId, uploadId, signerId, historyDate } from "./records.mjs";

const reportTypes = ["detailed-cap-table", "shareholder-information", "shareholder-transactions"];
const holderPath = `/shareholders/${holder.id}`;
const requestPath = `/transfer-requests/${requestId}`;
const importPath = "/settings/data-import";
const uploadBody = { name: "fixture.txt", contentType: "text/plain", size: 12 };
const writes = [
  ["POST", "/shareholders", { name: "Must not create" }],
  ["PUT", holderPath, { name: "Must not change" }],
  ["POST", `${holderPath}/certificates`, { requestId, shareClass: "Common", quantity: 1, issueDate: historyDate, vestingSchedule: "Immediate" }],
  ["POST", `${holderPath}/certificates/C-1/transfers`, { requestId, quantity: 1, recipientId: recipient.id, transferDate: historyDate }],
  ["POST", `/transfers/${transfer}/attachments`, { attachments: [{ ...uploadBody, objectPath: `/objects/uploads/${uploadId}` }] }],
  ["POST", `${requestPath}/attachments`, { attachments: [{ ...uploadBody, objectPath: `/objects/uploads/${uploadId}` }] }],
  ["POST", requestPath, { decision: "approve" }],
  ["POST", requestPath, { decision: "reject" }],
  ["POST", `${requestPath}/email-notifications/retry`],
  ["POST", "/storage/uploads/request-url", uploadBody],
  ["PUT", `/storage/uploads/${uploadId}/content`, "fixture text"],
  ["POST", "/settings/signature-uploads", { ...uploadBody, contentType: "image/png" }],
  ["POST", "/settings/signoffs", { name: "Fixture", email: "fixture@example.test", signaturePath: `/objects/uploads/${uploadId}` }],
  ["PUT", `/settings/signoffs/${signerId}`, { emailNotificationsEnabled: true }],
  ["DELETE", `/settings/signoffs/${signerId}`],
  ["PUT", "/settings/share-prices", { commonPrice: "1.00", preferredPrice: "2.00", effectiveDate: historyDate }],
  ["POST", "/settings/certificate-templates", { name: "fixture.pdf", shareClass: "Common", objectPath: `/objects/uploads/${uploadId}` }],
  ["POST", `${importPath}/analyze`, { syntheticOnly: true, files: Array.from({ length: 3 }, (_, i) => ({ name: `fixture-${i}.xlsx`, base64: "Zml4dHVyZQ==" })) }],
  ["POST", `${importPath}/runs/${importId}/commit`, { syntheticOnly: true, acknowledgeWarnings: true }],
];

export async function checkViewerWrites(context, origin) {
  for (const [method, path, data] of writes) {
    const headers = { Origin: origin, ...(typeof data === "string" ? { "Content-Type": "text/plain" } : {}) };
    const response = await context.request.fetch(`${origin}/api${path}`, { method, data, headers });
    assert.equal(response.status(), 403, `${method} ${path} must return 403`);
    // A 403 from some unrelated validation (for example a disabled import) is not proof of role enforcement.
    assert.deepEqual(await response.json(), { error: "Read / Write access is required for this action." }, `${method} ${path}`);
  }
}

export async function checkControls(page, origin, role) {
  const editor = role === "editor";
  const go = path => page.goto(`${origin}${path}`);
  const byId = id => page.getByTestId(id);
  const visible = id => expect(byId(id), `${role}: ${id}`).toBeVisible();
  const gated = async (id, viewerState = "hidden") => {
    const control = expect(byId(id), `${role}: ${id}`);
    if (editor) { await control.toBeVisible(); await control.toBeEnabled(); }
    else if (viewerState === "disabled") await control.toBeDisabled();
    else await control.toHaveCount(0);
  };

  await go("/shareholders");
  await visible(`row-shareholder-${holder.id}`);
  await gated("link-create-shareholder");
  await byId(`link-open-${holder.id}`).click();
  await expect(byId("input-name")).toHaveValue(holder.name);
  await gated("input-name", "disabled");
  await gated("button-upload-photo", "disabled");
  await visible("table-certificates");
  await gated("button-transfer-shares");
  await gated("button-transfer-C-1");
  await gated("button-issue-certificate");
  await byId("link-certificate-C-1").click();
  await visible("detail-certificate");
  await gated("button-detail-transfer");
  await page.keyboard.press("Escape");
  await gated("dropzone-documents");
  await byId("tab-history").click();
  await expect(page.getByRole("tabpanel", { name: /history/i })).toBeVisible();
  await go("/shareholders/new");
  if (editor) await gated("button-save");
  else {
    await expect(page.getByText(/Creating shareholder records requires Read \/ Write access/)).toBeVisible();
    await gated("button-save");
  }

  await go("/transfers");
  const transferLink = page.getByTestId("list-global-transfers").locator(`a[href="/transfers/${transfer}"]`);
  await transferLink.click();
  await visible("detail-transfer");
  await gated("button-add-attachment");

  await go("/sign-off-requests");
  await byId(`link-signoff-${requestId}`).click();
  await visible("approval-status");
  await gated("button-approve-request");
  await gated("button-reject-request");
  await gated("button-add-attachment");

  await go("/settings?tab=signoffs");
  await visible(`row-signoff-${signerId}`);
  await gated("button-add-signoff");
  await gated(`button-edit-signoff-${signerId}`);
  await gated(`button-remove-signoff-${signerId}`);
  await gated(`checkbox-signoff-email-${signerId}`, "disabled");
  if (editor) {
    await byId("button-add-signoff").click();
    await gated("button-pick-signature");
    await page.keyboard.press("Escape");
  }
  await byId("tab-settings-prices").click();
  await gated("input-price-common", "disabled");
  await gated("input-price-preferred", "disabled");
  if (editor) await byId("input-price-common").fill("1.25");
  await gated("button-save-prices");
  await byId("tab-settings-certificates").click();
  await visible("certificate-templates-panel");
  await gated("upload-template-Common");
  await gated("upload-template-Preferred");
  await byId("tab-settings-audit").click();
  await expect(page.getByRole("heading", { name: "Audit log", exact: true })).toBeVisible();
  await byId("tab-settings-import").click();
  await visible("link-import-template"); // Import must be enabled; a disabled environment cannot prove role gating.
  await gated("button-choose-files", "disabled");
  await gated("checkbox-attest-anonymized", "disabled");
  if (editor) {
    await byId("input-import-files").setInputFiles(Array.from({ length: 3 }, (_, i) => ({
      name: `fixture-${i}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("not submitted"),
    })));
    await byId("checkbox-attest-anonymized").click();
  }
  await gated("button-stage-import", "disabled");
  await byId(`row-import-run-${importId}`).click();
  await visible("panel-run-detail");
  await gated("button-commit-import", "disabled");
  if (editor) {
    await byId("button-commit-import").click();
    await gated("button-confirm-commit");
    await byId("button-cancel-commit").click();
  }
}

export async function checkViewerExports(page, origin) {
  await page.goto(`${origin}/reports`);
  for (const report of reportTypes) {
    await page.getByTestId(`button-report-${report}`).click();
    const [download, response] = await Promise.all([
      page.waitForEvent("download", { timeout: 10_000 }),
      page.waitForResponse(res => res.url() === `${origin}/api/reports/${report}/export` && res.request().method() === "POST"),
      page.getByTestId("button-run-report").click(),
    ]);
    assert.equal(response.status(), 200);
    assert.match(response.headers()["content-type"], /spreadsheetml\.sheet/);
    assert.match(download.suggestedFilename(), new RegExp(`^${report}-[0-9-]+\\.xlsx$`));
    const bytes = await readFile(await download.path());
    assert.equal(bytes.readUInt32LE(), 0x04034b50, "XLSX must be a ZIP workbook, not an HTML error page");
  }
}
