import type { Request, Response, NextFunction } from "express";
import { configuredApplicationOrigin } from "../application-origin";
import { CertificateError } from "../certificates";

export type ImportActor = { id: string; name: string };
export type ImportMode = "off" | "preview" | "azure";
function azureHosted(env: NodeJS.ProcessEnv) {
  return Boolean(
    (env.WEBSITE_INSTANCE_ID && env.WEBSITE_SITE_NAME && /\.azurewebsites\.net$/i.test(env.WEBSITE_HOSTNAME ?? "")) ||
    (env.CONTAINER_APP_NAME && env.CONTAINER_APP_REVISION && env.CONTAINER_APP_REPLICA_NAME &&
      /\.azurecontainerapps\.io$/i.test(env.CONTAINER_APP_HOSTNAME ?? "")),
  );
}
const replitHosted = (env: NodeJS.ProcessEnv) => Boolean(env.REPLIT_DEPLOYMENT || env.REPL_ID || env.REPLIT_DEV_DOMAIN);
export function importConfiguration(env: NodeJS.ProcessEnv = process.env) {
  // No import-specific setup for business users: use the existing Azure app
  // configuration. Explicit off/false settings remain optional IT pause controls.
  const mode = env.LEGACY_IMPORT_MODE ?? (env.NODE_ENV === "development" ? "preview"
    : env.NODE_ENV === "production" && azureHosted(env) && !replitHosted(env) ? "azure" : "off");
  const deny = (message: string) => ({ mode: (["preview", "azure"].includes(mode) ? mode : "off") as ImportMode, available: false, message });
  if (env.LEGACY_IMPORT_ENABLED !== undefined && !["true", "false"].includes(env.LEGACY_IMPORT_ENABLED))
    return deny("Invalid import enablement setting. Use exactly true or false.");
  if (!["off", "preview", "azure"].includes(mode)) return deny("Invalid import mode. Importing is disabled.");
  if (mode === "off" || env.LEGACY_IMPORT_ENABLED === "false") return deny("Importing is disabled by server configuration.");
  if (mode === "preview") {
    if (env.NODE_ENV !== "development" || (env.DATABASE_PROVIDER ?? "replit") !== "replit" || env.REPLIT_DEPLOYMENT)
      return deny("Sample import is enabled only in Replit development with the Replit database.");
    return { mode: "preview" as const, available: true, message: "Fully anonymized samples only. Existing Preview records are preserved; Azure and production are not targets." };
  }
  // Azure database credentials alone do not establish Azure hosting.
  if (replitHosted(env))
    return deny("Azure importing cannot run on a Replit host.");
  if (env.NODE_ENV !== "production" || env.DATABASE_PROVIDER !== "azure")
    return deny("Azure import requires the production runtime and Azure PostgreSQL provider.");
  if (!azureHosted(env)) return deny("Azure application hosting has not been established; importing remains disabled.");
  let origin: string | undefined;
  try { origin = configuredApplicationOrigin(env); } catch { return deny("Azure import requires a valid APP_PUBLIC_ORIGIN HTTPS setting."); }
  if (!origin || /\.replit\.(dev|app)$/i.test(new URL(origin).hostname))
    return deny("Azure import requires an explicitly configured, non-Replit application origin.");
  if (env.OBJECT_STORAGE_PROVIDER !== "sharepoint") return deny("Azure imports require SharePoint file storage.");
  if (["CLIENT_ID", "CLIENT_SECRET", "SHAREPOINT_HOSTNAME", "SHAREPOINT_SITE_PATH", "SHAREPOINT_LIBRARY", "SHAREPOINT_ROOT_FOLDER"].some(k => !env[k]?.trim()))
    return deny("Azure import requires complete server-side Entra and SharePoint configuration.");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(env.TENANT_ID ?? ""))
    return deny("Azure import requires the configured Microsoft Entra tenant.");
  return { mode: "azure" as const, available: true, message: "Azure-hosted, add-only legacy import. Real files must stay within the approved Azure/SharePoint environment." };
}
export function importAvailability(env: NodeJS.ProcessEnv = process.env, actor?: ImportActor) {
  const config = importConfiguration(env);
  let enabled = config.available, message = config.message;
  if (enabled && config.mode === "azure" && !actor?.id) {
    enabled = false; message = "Sign into the application to use the import utility. No separate import role or approval is required.";
  }
  return {
    enabled, mode: config.mode, requiresSyntheticData: config.mode !== "azure",
    environment: config.mode === "preview" ? "Replit Preview — synthetic data only" : config.mode === "azure" ? "Azure" : "Disabled",
    message,
  };
}
export function requireImportAccess(actor: ImportActor): "preview" | "azure" {
  if (!actor.id) throw new CertificateError(401, "Sign into the application to use the import utility.");
  const status = importAvailability(process.env, actor);
  if (!actor.id || !status.enabled || status.mode === "off") throw new CertificateError(403, status.message);
  return status.mode;
}
/** Deliberate sample CLI guard: a CLI cannot gain Azure rights from a flag. */
export function requirePreviewImport() {
  const status = importAvailability();
  if (!status.enabled || status.mode !== "preview") throw new CertificateError(403, "Sample import is enabled only in Replit development with the Replit database. Production and Azure CLI imports are disabled.");
}
export const importActor = (req: Request): ImportActor => ({
  id: req.user?.id ?? "", name: [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") || req.user?.id || "",
});
/** Mounted before the upload body parser, so denied callers are not parsed. */
export function requireImportUpload(req: Request, res: Response, next: NextFunction) {
  try { requireImportAccess(importActor(req)); next(); }
  catch (error) {
    if (error instanceof CertificateError) { res.status(error.status).json({ error: error.message }); return; }
    next(error);
  }
}
