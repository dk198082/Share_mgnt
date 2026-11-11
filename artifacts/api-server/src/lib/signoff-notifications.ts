import { and, eq, sql } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  db, signoffEmailNotificationsTable, signoffResultEmailNotificationsTable,
  transferRequestsTable, type SignoffEmailStatus, type SignoffResultEmailStatus,
} from "@workspace/db";
import { CertificateError, type Transaction } from "./certificates";

export type EmailNotificationSummary = { total: number; accepted: number; failed: number; unknown: number; pending: number; skipped: number };
type EmailMessage = { recipient: string; requestKind: "Transfer" | "Issuance"; requestUrl: string };
type EmailSendResult = { outcome: "Accepted" | "Failed" | "Unknown"; status: number | null; failureCode: string | null };
type EmailSender = (message: EmailMessage) => Promise<EmailSendResult>;
type ResultEmailMessage = EmailMessage & { outcome: "Approved" | "Rejected" };
type ResultEmailSender = (message: ResultEmailMessage) => Promise<EmailSendResult>;

const connectors = new ReplitConnectors();

export function createOutlookMailBody(message: EmailMessage) {
  return {
    message: {
      subject: `Approval requested: ${message.requestKind === "Issuance" ? "Certificate issuance" : "Share transfer"}`,
      body: {
        contentType: "Text",
        content: `A ${message.requestKind === "Issuance" ? "certificate issuance" : "share transfer"} is awaiting your approval in Shareholder Management.\n\nReview and record your decision:\n${message.requestUrl}\n\nSign in to open Pending Sign Off Requests.`,
      },
      toRecipients: [{ emailAddress: { address: message.recipient } }],
    },
    saveToSentItems: true,
  };
}

export function createOutlookResultMailBody(message: ResultEmailMessage) {
  const requestType = message.requestKind === "Issuance" ? "Certificate issuance" : "Share transfer";
  return {
    message: {
      subject: `${requestType} request: ${message.outcome}`,
      body: {
        contentType: "Text",
        content: `${requestType} request ${message.outcome.toLowerCase()}.\n\n${message.requestUrl}`,
      },
      toRecipients: [{ emailAddress: { address: message.recipient } }],
    },
    saveToSentItems: true,
  };
}

async function sendOutlookEmail(message: EmailMessage): Promise<EmailSendResult> {
  return sendOutlookBody(createOutlookMailBody(message));
}

async function sendOutlookResultEmail(message: ResultEmailMessage): Promise<EmailSendResult> {
  return sendOutlookBody(createOutlookResultMailBody(message));
}

async function sendOutlookBody(body: ReturnType<typeof createOutlookMailBody> | ReturnType<typeof createOutlookResultMailBody>): Promise<EmailSendResult> {
  try {
    const response = await connectors.proxy("outlook", "/v1.0/me/sendMail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 202 || response.status === 204) return { outcome: "Accepted", status: response.status, failureCode: null };
    if (response.status >= 500) return { outcome: "Unknown", status: response.status, failureCode: "outlook_outcome_unknown" };
    return { outcome: "Failed", status: response.status, failureCode: response.status === 401 || response.status === 403 ? "outlook_permission" : "outlook_rejected" };
  } catch {
    return { outcome: "Unknown", status: null, failureCode: "outlook_outcome_unknown" };
  }
}

/** Deliver at most once after the terminal decision commits. Never retry an uncertain send automatically. */
export async function dispatchRequesterResultEmail(
  requestId: string,
  sender: ResultEmailSender = sendOutlookResultEmail,
  database: Pick<Transaction, "select" | "update"> = db,
): Promise<void> {
  const [row] = await database.update(signoffResultEmailNotificationsTable)
    .set({ status: "Sending", attempts: sql`${signoffResultEmailNotificationsTable.attempts} + 1`, failureCode: null })
    .where(and(
      eq(signoffResultEmailNotificationsTable.requestId, requestId),
      eq(signoffResultEmailNotificationsTable.status, "Pending"),
    ))
    .returning();
  if (!row) return;

  const [request] = await database.select({ kind: transferRequestsTable.kind, status: transferRequestsTable.status })
    .from(transferRequestsTable).where(eq(transferRequestsTable.id, requestId));
  if (!request || (request.status !== "Completed" && request.status !== "Rejected")) {
    await database.update(signoffResultEmailNotificationsTable)
      .set({ status: "Failed", failureCode: "request_not_final" })
      .where(eq(signoffResultEmailNotificationsTable.id, row.id));
    return;
  }

  let sent: EmailSendResult;
  try {
    sent = await sender({
      recipient: row.recipientEmail, requestKind: request.kind, outcome: row.outcome,
      requestUrl: new URL(`/sign-off-requests/${encodeURIComponent(requestId)}`, row.appOrigin).toString(),
    });
  } catch {
    sent = { outcome: "Unknown", status: null, failureCode: "outlook_outcome_unknown" };
  }
  const status: SignoffResultEmailStatus = sent.outcome;
  await database.update(signoffResultEmailNotificationsTable).set({
    status, providerStatus: sent.status, failureCode: sent.failureCode,
    acceptedAt: sent.outcome === "Accepted" ? new Date() : null,
  }).where(eq(signoffResultEmailNotificationsTable.id, row.id));
}

async function summaryForRequest(requestId: string): Promise<EmailNotificationSummary> {
  const rows = await db.select({ status: signoffEmailNotificationsTable.status })
    .from(signoffEmailNotificationsTable).where(eq(signoffEmailNotificationsTable.requestId, requestId));
  return rows.reduce<EmailNotificationSummary>((result, { status }) => {
    result.total++;
    if (status === "Accepted") result.accepted++;
    else if (status === "Failed") result.failed++;
    else if (status === "Unknown") result.unknown++;
    else if (status === "Skipped") result.skipped++;
    else result.pending++;
    return result;
  }, { total: 0, accepted: 0, failed: 0, unknown: 0, pending: 0, skipped: 0 });
}

/** Claim pending deliveries atomically, so retries cannot send an already accepted message again. */
export async function dispatchSignoffEmails(requestId: string, sender: EmailSender = sendOutlookEmail): Promise<EmailNotificationSummary> {
  const [request] = await db.select({ id: transferRequestsTable.id, status: transferRequestsTable.status, kind: transferRequestsTable.kind })
    .from(transferRequestsTable).where(eq(transferRequestsTable.id, requestId));
  if (!request) throw new CertificateError(404, "Sign-off request not found.");
  if (request.status !== "Pending") {
    await db.update(signoffEmailNotificationsTable).set({ status: "Skipped", failureCode: "request_closed" })
      .where(and(eq(signoffEmailNotificationsTable.requestId, requestId), eq(signoffEmailNotificationsTable.status, "Pending")));
    return summaryForRequest(requestId);
  }

  const claimed = await db.update(signoffEmailNotificationsTable)
    .set({ status: "Sending", attempts: sql`${signoffEmailNotificationsTable.attempts} + 1`, failureCode: null })
    .where(and(eq(signoffEmailNotificationsTable.requestId, requestId), eq(signoffEmailNotificationsTable.status, "Pending")))
    .returning();

  for (const row of claimed) {
    const message: EmailMessage = {
      recipient: row.recipientEmail,
      requestKind: request.kind,
      requestUrl: new URL(`/sign-off-requests/${encodeURIComponent(requestId)}`, row.appOrigin).toString(),
    };
    const sent = await sender(message);
    const status: SignoffEmailStatus = sent.outcome;
    await db.update(signoffEmailNotificationsTable).set({
      status, providerStatus: sent.status, failureCode: sent.failureCode,
      acceptedAt: sent.outcome === "Accepted" ? new Date() : null,
    }).where(eq(signoffEmailNotificationsTable.id, row.id));
  }
  return summaryForRequest(requestId);
}

export async function retryFailedSignoffEmails(requestId: string): Promise<EmailNotificationSummary> {
  const [request] = await db.select({ status: transferRequestsTable.status })
    .from(transferRequestsTable).where(eq(transferRequestsTable.id, requestId));
  if (!request) throw new CertificateError(404, "Sign-off request not found.");
  if (request.status !== "Pending") throw new CertificateError(409, "Email notifications can only be retried while the request is pending.");
  await db.update(signoffEmailNotificationsTable).set({ status: "Pending", failureCode: null, providerStatus: null })
    .where(and(eq(signoffEmailNotificationsTable.requestId, requestId), eq(signoffEmailNotificationsTable.status, "Failed")));
  return dispatchSignoffEmails(requestId);
}

