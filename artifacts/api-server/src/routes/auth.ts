import { Router, type IRouter, type Request, type Response } from "express";
import { GetCurrentAuthUserResponse } from "@workspace/api-zod";
import * as oidc from "openid-client";
import {
  clearSession, createSession, getOidcConfig, getSession, getSessionId, identityFromClaims, safeReturnTo,
  SESSION_COOKIE, SESSION_TTL, type SessionData,
} from "../lib/auth";

const router: IRouter = Router();
const flowCookies = [
  "entra_verifier", "entra_nonce", "entra_state", "entra_return",
  "pilot_verifier", "pilot_nonce", "pilot_state", "pilot_return",
] as const;
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
// AZURE: Replit's own hosts (*.replit.dev / *.replit.app) are always trusted,
// since they're never attacker-controlled. Any other host — an Azure App
// Service/Container Apps hostname (*.azurewebsites.net, a custom domain,
// etc.) — must be listed explicitly in AUTH_ALLOWED_HOSTS (a comma-separated
// list of exact hostnames, no scheme, e.g.
// "shareholder-management.azurewebsites.net,shareholders.example.com").
// Without this, Azure deployments would fail every sign-in: the previous
// version of this check only ever allowed Replit hostnames.
const extraAllowedHosts = new Set(
  (process.env.AUTH_ALLOWED_HOSTS ?? "")
    .split(",")
    .map(host => host.trim().toLowerCase())
    .filter(Boolean),
);
function isAllowedAuthHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower.endsWith(".replit.dev") || lower.endsWith(".replit.app") || extraAllowedHosts.has(lower);
}

function origin(req: Request) {
  const host = req.get("x-forwarded-host") || req.get("host");

  if (!host || /[,/\\\s]/.test(host)) {
    throw new Error("Invalid request host");
  }

  // Local development uses HTTP.
  // Production deployments always use HTTPS.
  const protocol =
    process.env.NODE_ENV === "production" ? "https" : "http";

  const parsed = new URL(`${protocol}://${host}`);

  if (
    process.env.NODE_ENV !== "test" &&
    !isAllowedAuthHost(parsed.hostname)
  ) {
    throw new Error(
      "Sign-in is not available on this host. Set AUTH_ALLOWED_HOSTS to include it."
    );
  }

  return parsed.origin;
}


function clearFlow(res: Response) {
  for (const name of flowCookies) res.clearCookie(name, cookieOptions);
}
function clearLegacySessionCookie(res: Response) {
  res.clearCookie("pilot_sid", cookieOptions);
}
router.get("/auth/user", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(GetCurrentAuthUserResponse.parse({ user: req.user ?? null }));
});
router.get("/login", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const config = await getOidcConfig();
  const state = oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier();
  const redirect = oidc.buildAuthorizationUrl(config, {
    redirect_uri: `${origin(req)}/api/auth/callback`, scope: "openid profile email offline_access",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", state, nonce,
  });
  for (const [name, value] of Object.entries({
    entra_verifier: verifier, entra_nonce: nonce, entra_state: state, entra_return: safeReturnTo(req.query.returnTo),
  })) res.cookie(name, value, { ...cookieOptions, maxAge: 10 * 60 * 1000 });
  res.redirect(redirect.href);
});
router.get("/auth/callback", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const verifier = req.cookies?.entra_verifier, state = req.cookies?.entra_state, nonce = req.cookies?.entra_nonce;
  const returnTo = safeReturnTo(req.cookies?.entra_return);
  clearFlow(res);
  clearLegacySessionCookie(res);
  if (!verifier || !state || !nonce) { res.redirect("/sign-in?error=expired"); return; }
  let session: SessionData;
  try {
    const callback = new URL(`${origin(req)}/api/auth/callback`);
    callback.search = new URL(req.originalUrl, origin(req)).search;
    const tokens = await oidc.authorizationCodeGrant(await getOidcConfig(), callback, {
      pkceCodeVerifier: verifier, expectedState: state, expectedNonce: nonce, idTokenExpected: true,
    });
    const claims = tokens.claims();
    
      if (!claims) throw new Error("Missing identity claims");
      const identity = identityFromClaims(
        claims as unknown as Record<string, unknown>
      );

      session = {
        provider: "entra",
        user: identity,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token,

        expires_at: tokens.expiresIn()
          ? Math.floor(Date.now() / 1000) + tokens.expiresIn()!
          : claims.exp,

        // Microsoft logout hint
        login_hint:
          typeof claims.login_hint === "string"
            ? claims.login_hint
            : undefined,
      };

  } catch (error) {
    req.log.warn({ errorType: error instanceof Error ? error.name : "Error" }, "Microsoft Entra sign-in could not be completed");
    res.redirect("/sign-in?error=failed"); return;
  }
  const previous = getSessionId(req) ?? req.cookies?.pilot_sid;
  if (previous) await clearSession(res, previous);
  res.cookie(SESSION_COOKIE, await createSession(session), { ...cookieOptions, maxAge: SESSION_TTL });
  // res.redirect(returnTo);
  const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:5175";
  res.redirect(new URL(returnTo, appBaseUrl).toString());
});

router.get("/logout", async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {
    // 1. Get current session ID
    const sessionId =
      getSessionId(req) ?? req.cookies?.pilot_sid;

    // 2. Get session BEFORE destroying it
    const session = sessionId
      ? await getSession(sessionId)
      : null;

    // 3. Destroy application session
    await clearSession(res, sessionId);

    // 4. Clear legacy cookie
    clearLegacySessionCookie(res);

    // 5. Get Microsoft Client ID
    const clientId =
      process.env.AZURE_CLIENT_ID ||
      process.env.CLIENT_ID;

    const appBaseUrl =
      process.env.APP_BASE_URL ||
      "http://localhost:5175";

    // 6. If no Client ID, redirect to website
    if (!clientId) {
      return res.redirect(new URL("/", appBaseUrl).href);
    }

    // 7. Build Microsoft Entra logout URL
    const endSessionParams: {
      client_id: string;
      post_logout_redirect_uri: string;
      id_token_hint?: string;
      logout_hint?: string;
    } = {
      client_id: clientId,
      post_logout_redirect_uri:
        new URL("/", appBaseUrl).href,
    };

    // 8. Include ID token for proper logout
      if (session?.id_token) {
        endSessionParams.id_token_hint = session.id_token;
      }

      if (session?.login_hint) {
        endSessionParams.logout_hint = session.login_hint;
      }

    const config = await getOidcConfig();

    const logoutUrl = oidc.buildEndSessionUrl(
      config,
      endSessionParams
    );

    // 9. Redirect to Microsoft logout
    return res.redirect(logoutUrl.href);

  } catch (error) {
    req.log.error(
      { error },
      "Microsoft logout failed"
    );

    const appBaseUrl =
      process.env.APP_BASE_URL ||
      "http://localhost:5175";

    return res.redirect(new URL("/", appBaseUrl).href);
  }
});
export default router;
