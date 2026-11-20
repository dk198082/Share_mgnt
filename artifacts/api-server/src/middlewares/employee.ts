import type { Request, Response, NextFunction } from "express";
import { auditContext } from "../lib/audit";

export async function employeeRole(req: Request): Promise<string | null> {
  return req.user?.role ?? null;
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
export function requireEditor(req: Request, res: Response, next: NextFunction): void {
  res.set("Cache-Control", "no-store");
  if (!req.user) { res.status(401).json({ error: "Microsoft sign-in required." }); return; }
  if (req.user.role !== "editor") { res.status(403).json({ error: "Read / Write access is required for this action." }); return; }
  const user = req.user;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || user.id;
  auditContext.run({ id: user.id, name }, () => next());
}
export const requireAdmin = requireEditor;

/** All API writes require the Admin Console Read / Write entitlement.
 * Report exports use POST only to return a workbook and do not mutate records.
 */
export function requireEditorForWrites(req: Request, res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  const path = req.originalUrl.split("?")[0].replace(/^\/api(?=\/|$)/, "");
  if (/^\/reports\/[^/]+\/export$/.test(path)) { next(); return; }
  requireEditor(req, res, next);
}
