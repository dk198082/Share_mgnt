import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { db, pool, shareholdersTable, certificatesTable, certificateCountersTable, transferRequestsTable, signoffsTable, signoffEmailNotificationsTable, signoffResultEmailNotificationsTable } from "@workspace/db";
import { CertificateError, issueCertificateInTransaction, type Transaction } from "./certificates";
import { requestTransfer, decideRequest, presentRequest } from "./transfer-requests";
import { requestIssuance } from "./issuance-requests";
import { awaitingSigner } from "./approval-policy";
import { displayRole, employeeRoles } from "./access-users";
import { dispatchRequesterResultEmail } from "./signoff-notifications";

test("Administrator is the only effective access role, without restoring revoked access", () => {
  assert.deepEqual(employeeRoles, ["admin"]);
  for (const old of ["admin", "hr", "finance", "ceo", "cfo"]) assert.equal(displayRole(old), "admin");
  for (const removed of [null, undefined, "", "shareholder", "unknown"]) assert.equal(displayRole(removed), null);
});
test("all Settings signers govern transfer and issuance requests, including self-approval", async t => {
  const schema = `approval_checks_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const tx = <T,>(fn: (transaction: Transaction) => Promise<T>) => db.transaction(async transaction => {
    await transaction.execute(sql.raw(`SET LOCAL search_path TO "${schema}", public`));
    return fn(transaction);
  });
  const issueInput = () => ({ requestId: randomUUID(), shareClass: "Preferred" as const, quantity: 5, issueDate: "2026-01-01", vestingSchedule: "Fully vested upon grant" });
  const decide = (id: string, signer: string, decision: "approve" | "reject" = "approve") =>
    tx(transaction => decideRequest(transaction, id, `${signer}-user`, [`${signer}@example.test`], decision));
  try {
    for (const table of ["shareholders", "certificates", "certificate_counters", "shareholder_activity", "share_transfers", "transfer_requests", "signoffs", "signoff_email_notifications"]) {
      await pool.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    await pool.query(`ALTER TABLE "${schema}"."transfer_requests"
      ADD COLUMN IF NOT EXISTS "requester_email" text,
      ADD COLUMN IF NOT EXISTS "app_origin" text`);
    await pool.query(`CREATE TABLE "${schema}"."signoff_result_email_notifications" (
      "id" text PRIMARY KEY,
      "request_id" text NOT NULL UNIQUE,
      "recipient_email" text NOT NULL,
      "app_origin" text NOT NULL,
      "outcome" text NOT NULL,
      "status" text NOT NULL DEFAULT 'Pending',
      "attempts" integer NOT NULL DEFAULT 0,
      "provider_status" integer,
      "failure_code" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "accepted_at" timestamptz
    )`);
    await tx(async transaction => {
      await transaction.insert(shareholdersTable).values([{ id: "owner", data: { name: "Owner" } }, { id: "recipient", data: { name: "Recipient" } }]);
      await issueCertificateInTransaction(transaction, "owner", { ...issueInput(), shareClass: "Common", quantity: 10 }, "fixture");
    });
    await t.test("no configured signers blocks both operations without allocating a number", async () => {
      await assert.rejects(tx(transaction => requestIssuance(transaction, "owner", issueInput(), "alpha-user")), /at least one signatory/);
      await assert.rejects(tx(transaction => requestTransfer(transaction, "owner", "C-1",
        { requestId: randomUUID(), quantity: 1, recipientId: "recipient", transferDate: "2026-01-02" }, "alpha-user")), /at least one signatory/);
      assert.equal((await tx(transaction => transaction.select().from(certificatesTable))).length, 1);
    });
    await tx(transaction => transaction.insert(signoffsTable).values(["alpha", "beta", "gamma"].map(id => ({
      id, name: `${id} signer`, email: `${id}@example.test`, signaturePath: `/objects/uploads/${id}`, updatedBy: "admin",
    }))));
    await t.test("new requests queue one private email per captured signer and idempotent replays do not duplicate them", async () => {
      const origin = "https://shareholder.example.test";
      const issuanceInput = issueInput();
      const issuance = await tx(transaction => requestIssuance(transaction, "owner", issuanceInput, "alpha-user", origin, "requester@example.test"));
      const issuanceQueue = await tx(transaction => transaction.select().from(signoffEmailNotificationsTable)
        .where(eq(signoffEmailNotificationsTable.requestId, issuance.id)));
      assert.deepEqual(issuanceQueue.map(row => row.recipientEmail).sort(), ["alpha@example.test", "beta@example.test", "gamma@example.test"]);
      assert.ok(issuanceQueue.every(row => row.status === "Pending" && row.appOrigin === origin));
      assert.equal((await tx(transaction => requestIssuance(transaction, "owner", issuanceInput, "alpha-user", origin))).id, issuance.id);
      assert.equal((await tx(transaction => transaction.select().from(signoffEmailNotificationsTable)
        .where(eq(signoffEmailNotificationsTable.requestId, issuance.id)))).length, 3);

      const transfer = await tx(transaction => requestTransfer(transaction, "owner", "C-1", {
        requestId: randomUUID(), quantity: 1, recipientId: "recipient", transferDate: "2026-01-02",
      }, "alpha-user", origin, "requester@example.test"));
      assert.equal((await tx(transaction => transaction.select().from(signoffEmailNotificationsTable)
        .where(eq(signoffEmailNotificationsTable.requestId, transfer.id)))).length, 3);
      assert.equal(issuance.requesterEmail, "requester@example.test");
      assert.equal(issuance.appOrigin, origin);
      assert.equal(transfer.requesterEmail, "requester@example.test");
      const visible = presentRequest(issuance);
      assert.equal("requesterEmail" in visible, false);
      assert.equal("appOrigin" in visible, false);
    });
    await t.test("email-disabled signers remain required approvers but are omitted from new email outboxes", async () => {
      const beforeToggle = await tx(transaction => requestIssuance(transaction, "owner", issueInput(), "alpha-user", "https://example.test"));
      const previousNotices = await tx(transaction => transaction.select().from(signoffEmailNotificationsTable)
        .where(eq(signoffEmailNotificationsTable.requestId, beforeToggle.id)));
      assert.equal(previousNotices.length, 3);
      await tx(transaction => transaction.update(signoffsTable).set({ emailNotificationsEnabled: false }).where(eq(signoffsTable.id, "beta")));
      assert.equal(beforeToggle.requiredSigners?.find(s => s.id === "beta")?.emailNotificationsEnabled, true,
        "changing Settings must not alter a request's captured notification preference");
      assert.equal((await tx(transaction => transaction.select().from(signoffEmailNotificationsTable)
        .where(eq(signoffEmailNotificationsTable.requestId, beforeToggle.id)))).length, 3,
      "a change to Settings must not delete notifications for an already submitted request");
      const row = await tx(transaction => requestIssuance(transaction, "owner", issueInput(), "alpha-user", "https://example.test", "owner@example.test"));
      assert.equal(row.requiredSigners?.length, 3);
      assert.equal(row.requiredSigners?.find(s => s.id === "beta")?.emailNotificationsEnabled, false);
      assert.equal(row.requiredSigners?.find(s => s.id === "alpha")?.emailNotificationsEnabled, true);
      assert.ok(awaitingSigner(row, { id: "beta-user", emails: ["beta@example.test"] }), "disabled email must not disable approval authority");
      const notices = await tx(transaction => transaction.select().from(signoffEmailNotificationsTable)
        .where(eq(signoffEmailNotificationsTable.requestId, row.id)));
      assert.deepEqual(notices.map(n => n.recipientEmail).sort(), ["alpha@example.test", "gamma@example.test"]);
      await tx(transaction => transaction.update(signoffsTable).set({ emailNotificationsEnabled: true }).where(eq(signoffsTable.id, "beta")));
    });
    await t.test("three signers, self-approval, exact retries and issuance only after the last signature", async () => {
      const input = issueInput();
      const row = await tx(transaction => requestIssuance(transaction, "owner", input, "alpha-user"));
      assert.equal(row.requiredSigners?.length, 3);
      assert.equal(row.approvals.length, 0);
      assert.equal(row.kind, "Issuance");
      assert.ok(awaitingSigner(row, { id: "alpha-user", emails: ["ALPHA@example.test"] }));
      assert.ok(presentRequest(row, [], { id: "alpha-user", emails: ["alpha@example.test"] }).canApprove);
      await assert.rejects(decide(row.id, "unconfigured-admin"), e => e instanceof CertificateError && e.status === 403);
      const first = await decide(row.id, "alpha");
      assert.equal(first.status, "Pending");
      assert.equal(first.approvals[0].userId, row.requestedBy);
      assert.equal((await decide(row.id, "alpha")).approvals[0].approvedAt, first.approvals[0].approvedAt);
      assert.equal((await decide(row.id, "beta")).status, "Pending");
      assert.equal((await tx(transaction => transaction.select().from(certificatesTable))).length, 1);
      const complete = await decide(row.id, "gamma");
      assert.equal(complete.status, "Completed");
      assert.equal(complete.recipientCertificateId, "P-1");
      assert.equal(complete.approvals.length, 3);
      assert.equal(complete.ceoApprovedBy, null);
      assert.equal(complete.cfoApprovedBy, null);
      assert.equal((await decide(row.id, "gamma")).recipientCertificateId, "P-1");
      assert.equal((await tx(transaction => requestIssuance(transaction, "owner", input, "alpha-user"))).status, "Completed");
      await assert.rejects(tx(transaction => requestIssuance(transaction, "owner", { ...input, quantity: 6 }, "alpha-user")), /already used/);
      assert.equal((await tx(transaction => transaction.select().from(certificatesTable))).length, 2);
    });
    await t.test("pending signer and signature snapshots survive Settings edits/removal", async () => {
      const old = await tx(transaction => requestIssuance(transaction, "owner", issueInput(), "alpha-user"));
      await tx(async transaction => {
        await transaction.delete(signoffsTable).where(eq(signoffsTable.id, "gamma"));
        await transaction.insert(signoffsTable).values({ id: "delta", name: "Delta signer", email: "delta@example.test", signaturePath: "/objects/uploads/delta", updatedBy: "admin" });
        await transaction.update(signoffsTable).set({ signaturePath: "/objects/uploads/new-alpha" }).where(eq(signoffsTable.id, "alpha"));
      });
      await decide(old.id, "alpha"); await decide(old.id, "beta");
      const completed = await decide(old.id, "gamma");
      assert.equal(completed.status, "Completed");
      assert.equal(completed.approvals.find(v => v.id === "alpha")?.signaturePath, "/objects/uploads/alpha");
      const fresh = await tx(transaction => requestIssuance(transaction, "owner", issueInput(), "alpha-user"));
      assert.deepEqual(fresh.requiredSigners?.map(s => s.id), ["alpha", "beta", "delta"]);
      await assert.rejects(decide(fresh.id, "gamma"), e => e instanceof CertificateError && e.status === 403);
      const before = await tx(transaction => transaction.select().from(certificateCountersTable));
      const rejected = await decide(fresh.id, "delta", "reject");
      assert.equal(rejected.status, "Rejected");
      assert.equal((await decide(fresh.id, "delta", "reject")).id, fresh.id);
      await assert.rejects(decide(fresh.id, "alpha"), /rejected/);
      assert.deepEqual(await tx(transaction => transaction.select().from(certificateCountersTable)), before);
    });
    await t.test("a failed final issuance transaction rolls back its signature and counter together", async () => {
      const row = await tx(transaction => requestIssuance(transaction, "owner", issueInput(), "alpha-user"));
      await decide(row.id, "alpha"); await decide(row.id, "beta");
      const before = await tx(transaction => transaction.select().from(certificateCountersTable));
      await assert.rejects(tx(async transaction => {
        await decideRequest(transaction, row.id, "delta-user", ["delta@example.test"], "approve");
        throw new Error("forced rollback");
      }), /forced rollback/);
      const [pending] = await tx(transaction => transaction.select().from(transferRequestsTable).where(eq(transferRequestsTable.id, row.id)));
      assert.equal(pending.status, "Pending");
      assert.equal(pending.approvals.length, 2);
      assert.deepEqual(await tx(transaction => transaction.select().from(certificateCountersTable)), before);
      assert.equal((await decide(row.id, "delta")).status, "Completed");
    });
    await t.test("old pending role signatures remain reference-only and never count as new approvals", async () => {
      const row = await tx(transaction => requestTransfer(transaction, "owner", "C-1",
        { requestId: randomUUID(), quantity: 1, recipientId: "recipient", transferDate: "2026-01-02" }, "alpha-user"));
      await tx(transaction => transaction.update(transferRequestsTable).set({ requiredSigners: null, ceoApprovedBy: "old-executive", ceoApprovedAt: new Date() }).where(eq(transferRequestsTable.id, row.id)));
      const first = await decide(row.id, "alpha");
      assert.equal(first.status, "Pending");
      assert.equal(first.approvals.length, 1);
      assert.equal(first.ceoApprovedBy, "old-executive");
      await decide(row.id, "beta");
      const done = await decide(row.id, "delta");
      assert.equal(done.status, "Completed");
      assert.equal(done.approvals.length, 3);
      assert.equal(done.ceoApprovedBy, "old-executive");
      assert.ok(presentRequest(done).legacyApprovals);
    });
    await t.test("one configured administrator can approve their own issuance without an extra role", async () => {
      await tx(async transaction => {
        await transaction.delete(signoffsTable).where(eq(signoffsTable.id, "beta"));
        await transaction.delete(signoffsTable).where(eq(signoffsTable.id, "delta"));
      });
      const request = await tx(transaction => requestIssuance(transaction, "owner", issueInput(), "alpha-user"));
      assert.equal(request.requiredSigners?.length, 1);
      assert.equal(request.status, "Pending");
      const completed = await decide(request.id, "alpha");
      assert.equal(completed.status, "Completed");
      assert.equal(completed.approvals.length, 1);
      assert.equal(completed.approvals[0].userId, request.requestedBy);
    });
    await t.test("final approval and rejection queue one result email for the original requester", async () => {
      await tx(transaction => transaction.insert(signoffsTable).values([
        { id: "beta", name: "beta signer", email: "beta@example.test", signaturePath: "/objects/uploads/beta", updatedBy: "admin" },
        { id: "gamma", name: "gamma signer", email: "gamma@example.test", signaturePath: "/objects/uploads/gamma", updatedBy: "admin" },
      ]));
      const approvedRequest = await tx(transaction => requestIssuance(transaction, "owner", issueInput(), "owner-user",
        "https://shareholder.example.test", "requester@example.test"));
      await decide(approvedRequest.id, "alpha");
      await decide(approvedRequest.id, "beta");
      assert.equal((await tx(transaction => transaction.select().from(signoffResultEmailNotificationsTable)
        .where(eq(signoffResultEmailNotificationsTable.requestId, approvedRequest.id)))).length, 0);
      assert.equal((await decide(approvedRequest.id, "gamma")).status, "Completed");
      assert.equal((await decide(approvedRequest.id, "gamma")).status, "Completed");
      const [approvedNotice] = await tx(transaction => transaction.select().from(signoffResultEmailNotificationsTable)
        .where(eq(signoffResultEmailNotificationsTable.requestId, approvedRequest.id)));
      assert.equal(approvedNotice.recipientEmail, "requester@example.test");
      assert.equal(approvedNotice.appOrigin, "https://shareholder.example.test");
      assert.equal(approvedNotice.outcome, "Approved");
      assert.equal(approvedNotice.status, "Pending");
      type DeliveredResultEmail = {
        recipient: string; requestKind: "Transfer" | "Issuance"; outcome: "Approved" | "Rejected"; requestUrl: string;
      };
      let deliveredMessage: DeliveredResultEmail | undefined;
      let deliveredCount = 0;
      const accepted = async (message: DeliveredResultEmail) => {
        deliveredCount++;
        deliveredMessage = message;
        return { outcome: "Accepted" as const, status: 202, failureCode: null };
      };
      await tx(transaction => dispatchRequesterResultEmail(approvedRequest.id, accepted, transaction));
      await tx(transaction => dispatchRequesterResultEmail(approvedRequest.id, accepted, transaction));
      assert.equal(deliveredMessage?.recipient, "requester@example.test");
      assert.equal(deliveredMessage?.outcome, "Approved");
      assert.equal(deliveredMessage?.requestKind, "Issuance");
      assert.equal(deliveredMessage?.requestUrl, `https://shareholder.example.test/sign-off-requests/${approvedRequest.id}`);
      assert.equal(deliveredCount, 1);
      const acceptedNotices = await tx(transaction => transaction.select().from(signoffResultEmailNotificationsTable)
        .where(eq(signoffResultEmailNotificationsTable.requestId, approvedRequest.id)));
      assert.equal(acceptedNotices[0]?.status, "Accepted");
      assert.equal(acceptedNotices.length, 1);

      const rejectedRequest = await tx(transaction => requestIssuance(transaction, "owner", issueInput(), "owner-user",
        "https://shareholder.example.test", "requester@example.test"));
      await decide(rejectedRequest.id, "alpha", "reject");
      await decide(rejectedRequest.id, "alpha", "reject");
      const [rejectedNotice] = await tx(transaction => transaction.select().from(signoffResultEmailNotificationsTable)
        .where(eq(signoffResultEmailNotificationsTable.requestId, rejectedRequest.id)));
      assert.equal(rejectedNotice.outcome, "Rejected");
      assert.equal(rejectedNotice.recipientEmail, "requester@example.test");
      assert.equal((await tx(transaction => transaction.select().from(signoffResultEmailNotificationsTable)
        .where(eq(signoffResultEmailNotificationsTable.requestId, rejectedRequest.id)))).length, 1);
      await tx(transaction => dispatchRequesterResultEmail(rejectedRequest.id, async () => ({
        outcome: "Failed", status: 403, failureCode: "outlook_permission",
      }), transaction));
      assert.equal((await tx(transaction => transaction.select().from(transferRequestsTable)
        .where(eq(transferRequestsTable.id, rejectedRequest.id)))).at(0)?.status, "Rejected");
      assert.equal((await tx(transaction => transaction.select().from(signoffResultEmailNotificationsTable)
        .where(eq(signoffResultEmailNotificationsTable.requestId, rejectedRequest.id)))).at(0)?.status, "Failed");
    });
  } finally {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
