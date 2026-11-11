import type { AuthUser } from "@workspace/api-zod";
import type { Request, Response, NextFunction } from "express";
import * as oidc from "openid-client";
import { clearSession, getOidcConfig, getSession, getSessionId, identityFromClaims, updateSession } from "../lib/auth";

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
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  req.isAuthenticated = function(this: Request) { return this.user != null; } as Request["isAuthenticated"];
  const sid = getSessionId(req);
  if (!sid || typeof sid !== "string" || !/^[a-f0-9]{64}$/.test(sid)) { next(); return; }
  const session = await getSession(sid);
  if (session?.provider !== "entra" || !session.user?.id) { await clearSession(res, sid); next(); return; }
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now >= session.expires_at) {
    try {
      if (!session.refresh_token) throw new Error("Expired session");
      const tokens = await oidc.refreshTokenGrant(await getOidcConfig(), session.refresh_token);
      const claims = tokens.claims();
      if (!claims || (claims.oid as string | undefined) !== session.user.id) throw new Error("Refresh identity unavailable");
      session.user = identityFromClaims(claims as unknown as Record<string, unknown>);
      session.access_token = tokens.access_token;
      session.id_token = tokens.id_token ?? session.id_token;
      session.refresh_token = tokens.refresh_token ?? session.refresh_token;
      session.expires_at = tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp;
      await updateSession(sid, session);
    } catch {
      await clearSession(res, sid);
      next(); return;
    }
  }
  req.user = session.user;
  next();
}
