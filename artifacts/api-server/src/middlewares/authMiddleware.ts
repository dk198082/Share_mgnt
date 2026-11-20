import type { AuthUser } from "@workspace/api-zod";
import type { Request, Response, NextFunction } from "express";
import * as oidc from "openid-client";
import { clearSessionCookie, deleteSession, getOidcConfig, getSessionId, getSessionSnapshot, identityFromClaims, updateSession, type SessionData } from "../lib/auth";
import { checkAdminConsoleAccess } from "../lib/admin-console";

declare global {
  namespace Express {
    interface User extends AuthUser {}
    interface Request {
      user?: User;
      isAuthenticated(): this is AuthedRequest;
    }
    interface AuthedRequest extends Request { user: User }
  }
}
export const ACCESS_RECHECK_INTERVAL_MS = 60_000;
const pending = new Map<string, Promise<AuthUser | null>>();

function validSession(session: SessionData | undefined): session is SessionData {
  return session?.provider === "entra" && Boolean(session.user?.id) &&
    ["viewer", "editor"].includes(session.user.role);
}

function tokenCurrent(session: SessionData, now: number): boolean {
  const expires = session.expires_at;
  return typeof expires === "number" && Number.isFinite(expires) && now < expires * 1_000;
}

function accessCurrent(session: SessionData, now: number): boolean {
  const checked = session.access_checked_at;
  return typeof checked === "number" && checked > 0 && checked <= now &&
    now - checked < ACCESS_RECHECK_INTERVAL_MS;
}

async function authorizeSession(sid: string): Promise<AuthUser | null> {
  const snapshot = await getSessionSnapshot(sid);
  if (!snapshot || !validSession(snapshot.session)) {
    if (snapshot) await deleteSession(sid);
    return null;
  }
  const { session, stored } = snapshot;
  const now = Date.now();
  const refresh = !tokenCurrent(session, now);
  if (!refresh && accessCurrent(session, now)) return session.user;

  try {
    if (refresh) {
      if (!session.refresh_token) throw new Error("Expired session");
      const tokens = await oidc.refreshTokenGrant(await getOidcConfig(), session.refresh_token);
      const claims = tokens.claims();
      if (!claims || (claims.oid as string | undefined) !== session.user.id) throw new Error("Refresh identity unavailable");
      session.user = { ...identityFromClaims(claims as unknown as Record<string, unknown>), role: session.user.role };
      session.access_token = tokens.access_token;
      session.id_token = tokens.id_token ?? session.id_token;
      session.refresh_token = tokens.refresh_token ?? session.refresh_token;
      const expiresIn = tokens.expiresIn();
      session.expires_at = expiresIn ? Math.floor(Date.now() / 1_000) + expiresIn : claims.exp;
    }
    // Measure freshness from the start of the check, not from when its response arrives.
    session.access_checked_at = Date.now();
    session.user.role = await checkAdminConsoleAccess(session.user.id);
  } catch {
    await deleteSession(sid);
    return null;
  }

  const verifiedNow = Date.now();
  if (!tokenCurrent(session, verifiedNow) || !accessCurrent(session, verifiedNow)) return null;
  if (await updateSession(sid, stored, session, refresh)) return session.user;

  // A different server may have changed or deleted this session during the check.
  // Never overwrite its result or authenticate using the older snapshot.
  const latest = (await getSessionSnapshot(sid))?.session;
  const checkedNow = Date.now();
  if (!validSession(latest) || !tokenCurrent(latest, checkedNow) || !accessCurrent(latest, checkedNow)) return null;
  if (session.user.role === "viewer" && latest.user.role === "editor") {
    // Do not keep a concurrently saved editor grant after observing a downgrade.
    await deleteSession(sid);
    return null;
  }
  return latest.user;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  req.isAuthenticated = function(this: Request) { return this.user != null; } as Request["isAuthenticated"];
  const sid = getSessionId(req);
  if (typeof sid !== "string" || !/^[a-f0-9]{64}$/.test(sid)) { next(); return; }
  let authorization = pending.get(sid);
  if (!authorization) {
    authorization = authorizeSession(sid).finally(() => {
      pending.delete(sid);
    });
    pending.set(sid, authorization);
  }
  const user = await authorization;
  if (user) {
    req.user = { ...user };
  } else {
    clearSessionCookie(res);
  }
  next();
}
