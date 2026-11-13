import crypto from "node:crypto";
import type { AuthUser } from "@workspace/api-zod";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import * as oidc from "openid-client";

export const SESSION_COOKIE = "entra_sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
export interface SessionData {
  provider: "entra";
  user: AuthUser;
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_at?: number;
}
let config: Promise<oidc.Configuration> | undefined;

export function getOidcConfig() {
  if (!config) {
    const clientId =
      process.env.AZURE_CLIENT_ID || process.env.CLIENT_ID;

    const clientSecret =
      process.env.AZURE_CLIENT_SECRET || process.env.CLIENT_SECRET;

    const tenantId = getTenantId();

    if (!clientId || !clientSecret) {
      throw new Error(
        "Microsoft Entra authentication requires AZURE_CLIENT_ID and AZURE_CLIENT_SECRET."
      );
    }

    const issuer =
      process.env.NODE_ENV === "test" && process.env.AUTH_TEST_ISSUER
        ? process.env.AUTH_TEST_ISSUER
        : `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/v2.0`;

    config = oidc.discovery(
      new URL(issuer),
      clientId,
      clientSecret
    ).catch(error => {
      config = undefined;
      throw error;
    });
  }

  return config;
}

function getTenantId() {
  const tenantId =
    process.env.NODE_ENV === "test" && process.env.AUTH_TEST_TENANT_ID
      ? process.env.AUTH_TEST_TENANT_ID
      : process.env.AZURE_TENANT_ID || process.env.TENANT_ID;

  if (!tenantId) {
    throw new Error(
      "Microsoft Entra authentication requires AZURE_TENANT_ID."
    );
  }

  return tenantId.trim();
}


export function identityFromClaims(claims: Record<string, unknown>): AuthUser {
  const stringOrNull = (v: unknown) => typeof v === "string" && v ? v : null;
  const oid = stringOrNull(claims.oid);
  const tenantId = stringOrNull(claims.tid);
  if (!oid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(oid)) {
    throw new Error("A valid Microsoft Entra object ID is required.");
  }
  if (!tenantId || tenantId.toLowerCase() !== getTenantId().toLowerCase()) {
    throw new Error("The authenticated account is not from the configured Microsoft Entra tenant.");
  }
  const principal = stringOrNull(claims.preferred_username ?? claims.upn);
  const email = (principal ?? stringOrNull(claims.email))?.trim().toLowerCase() ?? null;
  const displayName = stringOrNull(claims.name);
  const nameParts = displayName?.trim().split(/\s+/) ?? [];
  return {
    id: oid,
    email,
    // Entra does not consistently emit email_verified. A signed-in tenant UPN
    // is the employee identifier used for the app's existing signer matching.
    emailVerified: Boolean(email) && (claims.email_verified === true || Boolean(principal)),
    firstName: stringOrNull(claims.given_name ?? claims.first_name) ?? nameParts[0] ?? null,
    lastName: stringOrNull(claims.family_name ?? claims.last_name) ?? (nameParts.length > 1 ? nameParts.slice(1).join(" ") : null),
    profileImageUrl: stringOrNull(claims.picture),
  };
}
export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid, sess: data as unknown as Record<string, unknown>, expire: new Date(Date.now() + SESSION_TTL),
  });
  return sid;
}
export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.sid, sid));
  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sid);
    return null;
  }
  return row.sess as unknown as SessionData;
}
export async function updateSession(sid: string, data: SessionData) {
  await db.update(sessionsTable).set({
    sess: data as unknown as Record<string, unknown>, expire: new Date(Date.now() + SESSION_TTL),
  }).where(eq(sessionsTable.sid, sid));
}
export async function deleteSession(sid: string) {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}
export async function clearSession(res: Response, sid?: string) {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, {
  path: "/",
  secure: process.env.NODE_ENV === "production",
  httpOnly: true,
  sameSite: "lax"
 });
}
export function getSessionId(req: Request): string | undefined {
  return req.cookies?.[SESSION_COOKIE];
}
export function safeReturnTo(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") &&
    !/[\\\u0000-\u001f]/.test(value) ? value : "/";
}
