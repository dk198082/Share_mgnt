import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import { clientId, clientSecret, consoleKey, identities, oidcFixture, tenant } from "./oidc-fixture.mjs";

const work = process.env.BROWSER_TEST_WORK;
assert.ok(work && process.env.NODE_ENV === "test" && process.env.DATABASE_PROVIDER === "replit",
  "Run this test through the disposable browser permission launcher.");
const { pool } = await import("../../../lib/db/src/index.ts");
const { seed, snapshotRecords } = await import("./records.mjs");
const { checkControls, checkViewerExports, checkViewerWrites } = await import("./scenarios.mjs");
const apiRequire = createRequire(new URL("../../../artifacts/api-server/package.json", import.meta.url));
const express = apiRequire("express");

test("Entra viewer and editor permissions in Chromium", { timeout: 120_000 }, async t => {
  t.after(() => pool.end());
  await seed();
  const fixture = oidcFixture();
  const fixtureErrors = [];
  const web = express();
  web.use(express.static(path.join(work, "web")));
  web.use((_req, res) => res.sendFile(path.join(work, "web", "index.html")));
  let origin, api, browser;
  const server = createServer({ key: await readFile(path.join(work, "key.pem")), cert: await readFile(path.join(work, "cert.pem")) }, (req, res) => {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith("/oidc/") || url.pathname === "/api/access-check") {
      void fixture.handle(req, res, url).catch(error => {
        fixtureErrors.push(error);
        res.writeHead(500).end("Fixture request failed");
      });
    } else if (url.pathname.startsWith("/api/")) api(req, res);
    else web(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    try { await browser?.close(); }
    finally {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
    assert.deepEqual(fixtureErrors, [], "the OIDC and Admin Console fixtures must accept the real requests");
  });
  origin = `https://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, {
    AUTH_TEST_ISSUER: `${origin}/oidc`, AUTH_TEST_TENANT_ID: tenant, TENANT_ID: tenant,
    CLIENT_ID: clientId, CLIENT_SECRET: clientSecret, ADMIN_CONSOLE_URL: origin, ADMIN_CONSOLE_API_KEY: consoleKey,
    // No storage provider is available. Even an authorization regression cannot contact a storage sidecar.
    OBJECT_STORAGE_PROVIDER: "fixture-disabled", LOG_LEVEL: "warn",
  });
  const fetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, origin, "server fetch must stay in the isolated fixture");
    return fetch(input, init);
  });
  api = (await import("../../../artifacts/api-server/src/app.ts")).default;
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE });

  async function login(role) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    fixture.selectAccount(role);
    await page.goto(`${origin}/sign-in?redirect_url=%2Fshareholders`);
    await page.waitForURL(`${origin}/shareholders`, { timeout: 12_000 }).catch(error => {
      throw new Error(`${role} OIDC sign-in did not return to Shareholders (last page: ${new URL(page.url()).pathname}).`, { cause: fixtureErrors[0] ?? error });
    });
    const response = await context.request.get(`${origin}/api/auth/user`);
    assert.equal(response.status(), 200);
    const { user } = await response.json();
    assert.equal(user?.id, identities[role].id);
    assert.equal(user?.role, role);
    const cookies = await context.cookies();
    assert.ok(cookies.some(cookie => cookie.name === "entra_sid" && cookie.httpOnly && cookie.secure));
    return { context, page };
  }

  const viewer = await login("viewer");
  const editor = await login("editor");
  assert.deepEqual(fixture.accessChecks, new Set(["viewer", "editor"]));
  // The test issuer is accepted only in NODE_ENV=test; the real synthetic-import
  // policy is active only in development. Switch *after* real sessions are created.
  // The API stays on our loopback server and keeps using the same session middleware.
  process.env.NODE_ENV = "development";
  const baseline = await snapshotRecords();
  const browserWrites = [];
  viewer.page.on("request", req => {
    const { pathname } = new URL(req.url());
    if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method()) &&
      !/^\/api\/reports\/[^/]+\/export$/.test(pathname)) browserWrites.push(`${req.method()} ${pathname}`);
  });
  await t.test("viewer can browse and download all three reports without emitting writes", async () => {
    await checkControls(viewer.page, origin, "viewer");
    await checkViewerExports(viewer.page, origin);
    assert.deepEqual(browserWrites, []);
  });
  await t.test("viewer direct writes are blocked by the editor entitlement and leave records unchanged", async () => {
    await checkViewerWrites(viewer.context, origin);
    assert.deepEqual(await snapshotRecords(), baseline);
  });
  await t.test("editor sees the corresponding controls and can create a Shareholder", async () => {
    await checkControls(editor.page, origin, "editor");
    await editor.page.goto(`${origin}/shareholders/new`);
    const name = "Editor-created fictional Shareholder";
    await editor.page.getByTestId("input-name").fill(name);
    const [response] = await Promise.all([
      editor.page.waitForResponse(res => res.url() === `${origin}/api/shareholders` && res.request().method() === "POST"),
      editor.page.getByTestId("button-save").click(),
    ]);
    assert.equal(response.status(), 201);
    const { id } = await response.json();
    const viewerRead = await viewer.context.request.get(`${origin}/api/shareholders/${id}`);
    assert.equal(viewerRead.status(), 200);
    assert.equal((await viewerRead.json()).name, name);
  });
});
