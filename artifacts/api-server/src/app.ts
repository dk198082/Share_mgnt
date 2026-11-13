import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import { IdentityLookupError } from "./lib/identity-lookup";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import cookieParser from "cookie-parser";
import { authMiddleware } from "./middlewares/authMiddleware";

const app: Express = express();

// AZURE: Azure App Service/Container Apps terminates TLS at a reverse proxy
// in front of the container and forwards plain HTTP, setting X-Forwarded-*
// headers. Without this, req.secure/req.protocol would read "http" and the
// "secure" cookies this app sets (see cookieOptions in routes/auth.ts) would
// be dropped by the browser since the app would appear to be serving HTTP.
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);
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
// AZURE: this app's own routers never 404 unmatched paths themselves (no
// catch-all inside routes/index.ts), so an unknown /api/* path would
// otherwise fall through to the SPA static fallback below and wrongly
// return 200 with index.html once STATIC_DIR serving is added for Azure.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof IdentityLookupError) {
    req.log.warn({ errorType: err.name, upstreamStatus: err.upstreamStatus }, "Live sign-in verification failed");
    if (err.status === 503) res.set("Retry-After", "1");
    res.status(err.status).json({ error: err.message });
    return;
  }
  const dbError = err as {
  code?: string;
  detail?: string;
  constraint?: string;
  table?: string;
  schema?: string;
};

req.log.error({
  errorType: err instanceof Error ? err.name : "Error",
  errorMessage: err instanceof Error ? err.message : String(err),
  errorCode: dbError.code,
  errorDetail: dbError.detail,
  errorTable: dbError.table,
  errorSchema: dbError.schema,
  errorConstraint: dbError.constraint,
}, "Request failed");

  res.status(500).json({ error: "The request could not be completed. Please try again." });
});

// AZURE: on Replit, the frontend (artifacts/shareholder-management) and this
// API are two separate deployed services behind Replit's own router. On
// Azure this ships as one container, so this server also serves the built
// frontend as static files, with an SPA fallback for client-side routes.
// Unset in local dev; set by the Dockerfile below in production.
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  const indexHtml = path.join(staticDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    throw new Error(`STATIC_DIR is set to "${staticDir}" but "${indexHtml}" does not exist. Did the frontend build run?`);
  }
  app.use(express.static(staticDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(indexHtml);
  });
}

export default app;
