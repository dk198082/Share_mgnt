import express, { type Express } from "express";
import path from "node:path";
import fs from "node:fs";
import { IdentityLookupError } from "./lib/identity-lookup";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import cookieParser from "cookie-parser";
import { authMiddleware } from "./middlewares/authMiddleware";
import { requireEditorForWrites, requireEmployee } from "./middlewares/employee";
import { requireImportUpload } from "./lib/legacy-import/access";

const app: Express = express();

// AZURE: Azure App Service/Container Apps sits behind a reverse proxy (TLS
// terminates there, not here). Without this, req.protocol/req.secure and the
// client IP used for logging/rate-limiting would be wrong.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: false }));
app.use(cookieParser());
app.use(authMiddleware);
app.use("/api", requireEditorForWrites);
// XLSX bytes exist transiently in this bounded request only, never in logs or DB.
app.use("/api/settings/data-import/analyze", requireEmployee, requireImportUpload, express.json({ limit: "8mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (process.env.MAINTENANCE_READ_ONLY === "true" && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    res.set("Retry-After", "60");
    res.status(503).json({
      error: "Shareholder Management is temporarily read-only while its data is being copied. Please retry after the migration.",
    });
    return;
  }
  next();
});

app.use("/api", router);
// AZURE: no router mounted above 404s an unmatched path itself, so without
// this, an unknown /api/* path would fall through into the SPA static
// fallback below (once STATIC_DIR serving is added for Azure) and wrongly
// return 200 with index.html instead of 404.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// AZURE: in the single-container deployment the built SPA is served by this
// same process. STATIC_DIR is only set in that deployment; locally/on
// Replit the frontend is served by its own dev server, so this block is a
// no-op there.
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  const indexHtml = path.join(staticDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    throw new Error(`STATIC_DIR is set but "${indexHtml}" does not exist. Did the frontend build run?`);
  }
  app.use(express.static(staticDir));
  // AZURE: this app uses Express 5 (path-to-regexp v8), which rejects a bare
  // "*" wildcard route ("Missing parameter name") — it must be named.
  app.get("/*splat", (_req, res) => {
    res.sendFile(indexHtml);
  });
}

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (req.path === "/api/settings/data-import/analyze") {
    const bodyError = err as { type?: string };
    if (bodyError.type === "entity.too.large" || bodyError.type === "entity.parse.failed") {
      res.status(bodyError.type === "entity.too.large" ? 413 : 400).json({
        error: "Invalid import request or upload exceeds the supported size. Choose standard XLSX files totaling at most 5 MB.",
      });
      return;
    }
  }
  if (err instanceof IdentityLookupError) {
    req.log.warn({ errorType: err.name, upstreamStatus: err.upstreamStatus }, "Live sign-in verification failed");
    if (err.status === 503) res.set("Retry-After", "1");
    res.status(err.status).json({ error: err.message });
    return;
  }
  req.log.error({ errorType: err instanceof Error ? err.name : "Error" }, "Request failed");
  res.status(500).json({ error: "The request could not be completed. Please try again." });
});

export default app;
