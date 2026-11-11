import type { Request, Response, NextFunction } from "express";
import { auditContext } from "../lib/audit";

/** Compatibility permission context: every authenticated pilot participant has equal access.
 * Access to the published pilot itself is managed through Replit private publishing.
 * This value is not a stored/granted application role.
 */
export async function employeeRole(req: Request): Promise<string | null> {
  return req.user ? "pilot" : null;
}
export async function employeeIdentity(req: Request) {
  if (!req.user) throw new Error("Pilot sign-in required");
  return {
    id: req.user.id,
    emails: req.user.emailVerified && req.user.email ? [req.user.email.trim().toLowerCase()] : [],
    notificationEmail: req.user.emailVerified ? req.user.email : null,
  };
}
export async function requireEmployee(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set("Cache-Control", "no-store");
  if (!req.user) { res.status(401).json({ error: "Pilot sign-in required." }); return; }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    const host = req.get("x-forwarded-host") || req.get("host");
    if (origin && new URL(origin).host !== host) {
      res.status(403).json({ error: "Invalid request origin." }); return;
    }
  }
  const user = req.user;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || user.id;
  auditContext.run({ id: user.id, name }, () => next());
}
// Retained for existing route composition; no Administrator role is required in the pilot.
export const requireAdmin = requireEmployee;
