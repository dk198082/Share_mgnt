import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { BlobServiceClient } from "@azure/storage-blob";
import { SharePointStoredObjectFile } from "./sharepoint-storage";
import { SharePointClient, sharePointClient, SharePointError } from "./sharepoint-client";
import { ObjectStorageService, objectStorageClient } from "./objectStorage";

const values = {
  CLIENT_ID: "fixture", CLIENT_SECRET: "fixture-secret", TENANT_ID: "fixture",
  SHAREPOINT_HOSTNAME: "fixture.sharepoint.com", SHAREPOINT_SITE_PATH: "/sites/fixture",
  SHAREPOINT_LIBRARY: "Documents", SHAREPOINT_ROOT_FOLDER: "Application", OBJECT_STORAGE_PROVIDER: "sharepoint",
  DATABASE_PROVIDER: "replit", DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/never_connect",
};
async function fixture(run: (files: Map<string, Buffer>) => Promise<void>) {
  const old = Object.fromEntries([...Object.keys(values), "AZURE_STORAGE_CONNECTION_STRING", "AZURE_STORAGE_CONTAINER"].map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  delete process.env.AZURE_STORAGE_CONNECTION_STRING;
  delete process.env.AZURE_STORAGE_CONTAINER;
  // Fail closed even if a future provider fallback swallows the thrown error.
  const forbidden: { mock: { callCount(): number } }[] = [
    mock.method(BlobServiceClient, "fromConnectionString", () => { throw new Error("Azure fallback forbidden"); }),
    mock.method(objectStorageClient, "bucket", () => { throw new Error("Replit fallback forbidden"); }),
    mock.method(globalThis, "fetch", async () => { throw new Error("Live network forbidden"); }),
  ];
  // Import only after selecting an unusable fictional database; no live records.
  const { pool } = await import("@workspace/db");
  forbidden.push(
    mock.method(pool, "query", () => { throw new Error("Live database forbidden"); }),
    mock.method(pool, "connect", () => { throw new Error("Live database forbidden"); }),
  );
  const files = new Map<string, Buffer>();
  mock.method(sharePointClient, "exists", async (parts: string[]) => files.has(parts.join("/")));
  mock.method(sharePointClient, "read", async (parts: string[]) => {
    const bytes = files.get(parts.join("/"));
    if (!bytes) throw new SharePointError(404, "itemNotFound");
    return Buffer.from(bytes);
  });
  mock.method(sharePointClient, "info", async (parts: string[]) => {
    const bytes = files.get(parts.join("/"));
    if (!bytes) throw new SharePointError(404, "itemNotFound");
    return { size: bytes.length, eTag: "v1" };
  });
  mock.method(sharePointClient, "create", async (parts: string[], bytes: Buffer) => {
    const key = parts.join("/");
    if (files.has(key)) throw new SharePointError(409, "nameAlreadyExists");
    files.set(key, Buffer.from(bytes));
  });
  try {
    await run(files);
    for (const guard of forbidden) assert.equal(guard.mock.callCount(), 0, "No fallback or live I/O");
  } finally {
    try { mock.restoreAll(); } finally {
      for (const [key, value] of Object.entries(old)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  }
}

test("SharePoint uploads use the existing authenticated API without Azure credentials", () => fixture(async () => {
  const storage = new ObjectStorageService();
  const url = await storage.getObjectEntityUploadURL();
  assert.match(url, /^\/api\/storage\/uploads\/[a-f0-9-]+\/content$/);
  assert.match(storage.normalizeObjectEntityPath(url), /^\/objects\/uploads\//);
  assert.equal(new URL(url, "https://app.example").search, "");
}));

test("Object storage writes and reads SharePoint with Azure configuration absent", () => fixture(async () => {
  const storage = new ObjectStorageService();
  const bytes = Buffer.from("sharepoint upload fixture");
  await storage.putPrivateObject("/objects/uploads/upload-fixture", bytes, "text/plain");
  const file = await storage.getObjectEntityFile("/objects/uploads/upload-fixture");
  assert.deepEqual((await file.download())[0], bytes);
  assert.equal((await file.getMetadata())[0].contentType, "text/plain");
}));

test("SharePoint preserves MIME type, bytes and ACL metadata and rejects overwrite", () => fixture(async files => {
  const file = new SharePointStoredObjectFile("uploads/test");
  const bytes = Buffer.from("%PDF-1.7\nfixture");
  await file.importVerified(bytes, "application/pdf", { "custom:aclPolicy": '{"visibility":"private"}' });
  assert.deepEqual((await file.download())[0], bytes);
  const [metadata] = await file.getMetadata();
  assert.equal(metadata.contentType, "application/pdf");
  assert.equal(metadata.metadata?.["custom:aclPolicy"], '{"visibility":"private"}');
  await assert.rejects(file.save(Buffer.from("changed"), { contentType: "text/plain" }), /immutable/);
  files.set("Application/uploads/test", Buffer.from("tampered bytes"));
  await assert.rejects(file.download(), /integrity/);
}));

test("Interrupted copy resumes without rewriting payload and conflicts are never overwritten", () => fixture(async files => {
  const file = new SharePointStoredObjectFile("certificate-pdfs/test");
  const bytes = Buffer.from("%PDF-1.7\nretained");
  files.set("Application/certificate-pdfs/test", bytes); // interrupted before sidecar save
  await file.importVerified(bytes, "application/pdf");
  await file.importVerified(bytes, "application/pdf"); // idempotent rerun
  await assert.rejects(file.importVerified(Buffer.from("different"), "application/pdf"), /conflicts/);
  assert.deepEqual(files.get("Application/certificate-pdfs/test"), bytes);
  files.delete("Application/.shareholder-metadata/certificate-pdfs/test.json");
  await assert.rejects(file.download(), /404/);
}));

test("Invalid paths and attempts to access private metadata as file bytes are rejected", () => fixture(async () => {
  for (const name of ["../secret", "uploads/../secret", ".shareholder-metadata/secret", "uploads/a\\b"]) {
    assert.throws(() => new SharePointStoredObjectFile(name), /Invalid/);
  }
}));

test("SharePoint rejects missing, malformed and inconsistent manifests before trusting photo/document bytes", () => fixture(async files => {
  const file = new SharePointStoredObjectFile("uploads/fictional-photo");
  const bytes = Buffer.from("fictional photo bytes");
  await file.save(bytes, { contentType: "image/png" });
  const key = "Application/.shareholder-metadata/uploads/fictional-photo.json";
  const original = files.get(key)!;
  const manifest = JSON.parse(original.toString());
  assert.equal(manifest.size, bytes.length);
  assert.equal(manifest.sha256, createHash("sha256").update(bytes).digest("hex"));
  for (const bad of [
    { ...manifest, version: 2 }, { ...manifest, size: 0 },
    { ...manifest, size: 1.5 }, { ...manifest, contentType: null },
    { ...manifest, sha256: "not-a-hash" }, { ...manifest, metadata: null },
  ]) {
    files.set(key, Buffer.from(JSON.stringify(bad)));
    await assert.rejects(file.getMetadata(), /metadata/);
    await assert.rejects(file.download(), /metadata/);
  }
  files.set(key, Buffer.from("{invalid"));
  await assert.rejects(file.download(), SyntaxError);
  files.delete(key);
  await assert.rejects(file.download(), /404/);
  files.set(key, Buffer.from(JSON.stringify({ ...manifest, size: bytes.length + 1 })));
  await assert.rejects(file.getMetadata(), /size verification/);
  await assert.rejects(file.download(), /integrity/);
  files.set(key, original);
  // Same-length corruption must fail the hash check, not merely a length check.
  files.set("Application/uploads/fictional-photo", Buffer.alloc(bytes.length, 120));
  await assert.rejects(file.download(), /integrity/);
  const chunks: Buffer[] = [];
  await assert.rejects(async () => {
    for await (const chunk of file.createReadStream()) chunks.push(chunk);
  }, /integrity/);
  assert.equal(chunks.length, 0, "No corrupt bytes may escape the verified stream");
}));

test("Fictional Shareholder photos render and documents download through authenticated SharePoint storage", () => fixture(async files => {
  const { db, uploadsTable } = await import("@workspace/db");
  type Upload = { objectPath: string; ownerId: string; name: string; contentType: string; purpose?: string };
  const uploads = new Map<string, Upload>();
  // The actual route builds a Drizzle equality expression. Resolve only its
  // parameter against our in-memory inventory; never execute SQL.
  const select = mock.method(db, "select", () => ({
    from: (table: unknown) => {
      assert.equal(table, uploadsTable);
      return { where: async (condition: { queryChunks: unknown[] }) => {
        const param = condition.queryChunks.find(chunk =>
          chunk && typeof chunk === "object" && "value" in chunk && typeof chunk.value === "string") as { value: string };
        assert.ok(param);
        return uploads.has(param.value) ? [uploads.get(param.value)] : [];
      } };
    },
  }) as unknown as ReturnType<typeof db.select>);
  mock.method(db, "insert", (table: unknown) => {
    assert.equal(table, uploadsTable);
    return { values: async (upload: Upload) => {
      assert.ok(!uploads.has(upload.objectPath));
      uploads.set(upload.objectPath, { ...upload });
    } } as unknown as ReturnType<typeof db.insert>;
  });
  const { default: router } = await import("../routes/storage");
  const app = express();
  app.use(express.json());
  // Test identity injection only: real requireEmployee still gates every route.
  app.use((req, _res, next) => {
    if (req.get("x-fixture-user") === "staff") req.user = {
      id: "fictional-staff", email: null, emailVerified: false,
      firstName: "Fictional", lastName: "Employee",
    } as NonNullable<typeof req.user>;
    next();
  });
  app.use("/api", router);
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "Fixture request failed" });
  });
  const image = sharp({ create: { width: 3, height: 2, channels: 3, background: "#246d53" } });
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 100]);
  const samples = [
    { name: "Fictional Shareholder.jpg", mime: "image/jpeg", bytes: await image.clone().jpeg().toBuffer(), format: "jpeg" },
    { name: "Fictional Shareholder.png", mime: "image/png", bytes: await image.clone().png().toBuffer(), format: "png" },
    { name: "Fictional Shareholder.webp", mime: "image/webp", bytes: await image.clone().webp().toBuffer(), format: "webp" },
    { name: "Fictional Shareholder résumé.pdf", mime: "application/pdf", bytes: Buffer.from(await pdf.save()) },
    { name: "Fictional Shareholder notes.txt", mime: "text/plain", bytes: Buffer.from("Fictional Shareholder — isolated document.\r\nNo live record.\n") },
  ];
  // Match the Shareholder's picturePath/documents shape without saving a record.
  const shareholders: { name: string; picturePath: string | null; documents: { name: string; objectPath: string; size: number }[] }[] = [];
  for (const sample of samples) {
    assert.equal(process.env.AZURE_STORAGE_CONNECTION_STRING, undefined);
    assert.equal(process.env.AZURE_STORAGE_CONTAINER, undefined);
    const registration = await request(app).post("/api/storage/uploads/request-url")
      .set("x-fixture-user", "staff")
      .send({ name: sample.name, contentType: sample.mime, size: sample.bytes.length }).expect(200);
    const { objectPath, uploadURL } = registration.body;
    assert.match(uploadURL, /^\/api\/storage\/uploads\/[^/]+\/content$/);
    assert.equal(objectPath, new ObjectStorageService().normalizeObjectEntityPath(uploadURL));
    await request(app).put(uploadURL).set("x-fixture-user", "staff")
      .set("Content-Type", sample.mime).send(sample.bytes).expect(204);
    const shareholder = {
      name: "Fictional Shareholder",
      picturePath: sample.format ? objectPath : null,
      documents: sample.format ? [] : [{ name: sample.name, objectPath, size: sample.bytes.length }],
    };
    shareholders.push(shareholder);
    const reference = shareholder.picturePath ?? shareholder.documents[0].objectPath;
    const response = await request(app).get(`/api/storage${reference}`)
      .set("x-fixture-user", "staff").buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", chunk => chunks.push(Buffer.from(chunk)));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      }).expect(200);
    assert.deepEqual(response.body, sample.bytes);
    assert.equal(response.body.length, sample.bytes.length);
    assert.equal(response.headers["content-type"].split(";")[0], sample.mime);
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["content-security-policy"], "sandbox");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["content-disposition"],
      `${sample.format ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(sample.name)}`);
    if (sample.format) {
      const decoded = await sharp(response.body).metadata();
      assert.equal(decoded.format, sample.format);
      assert.equal(decoded.width, 3);
      assert.equal(decoded.height, 2);
      assert.equal((await sharp(response.body).raw().toBuffer()).length, 18);
    } else if (sample.mime === "application/pdf") {
      assert.equal((await PDFDocument.load(response.body)).getPageCount(), 1);
    } else {
      assert.equal(response.body.toString("utf8"), sample.bytes.toString("utf8"));
    }
    const manifestKey = `Application/.shareholder-metadata/${objectPath.slice("/objects/".length)}.json`;
    const manifest = JSON.parse(files.get(manifestKey)!.toString());
    assert.equal(manifest.contentType, sample.mime);
    assert.equal(manifest.size, sample.bytes.length);
    assert.equal(manifest.sha256, createHash("sha256").update(sample.bytes).digest("hex"));
    // Anonymous requests must stop before any inventory/provider access.
    const counts = { selects: select.mock.callCount(), files: files.size };
    const providerCalls = () => [sharePointClient.read, sharePointClient.exists, sharePointClient.create].map(method =>
      (method as typeof method & { mock: { callCount(): number } }).mock.callCount());
    const beforeAnonymous = providerCalls();
    await request(app).get(`/api/storage${objectPath}`).expect(401).expect("Cache-Control", "no-store");
    await request(app).put(uploadURL).set("Content-Type", sample.mime).send(sample.bytes).expect(401);
    await request(app).post("/api/storage/uploads/request-url")
      .send({ name: sample.name, contentType: sample.mime, size: sample.bytes.length }).expect(401);
    assert.equal(select.mock.callCount(), counts.selects);
    assert.equal(files.size, counts.files);
    assert.deepEqual(providerCalls(), beforeAnonymous);
    // Metadata MIME mismatch and Graph size mismatch are rejected by the route.
    const original = files.get(manifestKey)!;
    for (const [change, status] of [
      [{ contentType: "application/octet-stream" }, 400],
      [{ size: sample.bytes.length + 1 }, 404],
    ] as const) {
      files.set(manifestKey, Buffer.from(JSON.stringify({ ...manifest, ...change })));
      await request(app).get(`/api/storage${objectPath}`).set("x-fixture-user", "staff").expect(status);
    }
    files.set(manifestKey, original);
    const payloadKey = `Application/${objectPath.slice("/objects/".length)}`;
    files.set(payloadKey, Buffer.alloc(sample.bytes.length, 120));
    await assert.rejects(
      request(app).get(`/api/storage${objectPath}`).set("x-fixture-user", "staff"),
      /aborted|socket hang up|ECONNRESET/i,
    );
    files.set(payloadKey, sample.bytes);
  }
  assert.equal(shareholders.filter(row => row.picturePath).length, 3);
  assert.equal(shareholders.flatMap(row => row.documents).length, 2);
  assert.equal(uploads.size, 5);
  assert.equal(files.size, 10, "Only fictional payloads and sidecars exist in memory");
}));

test("Graph errors never include token responses or Microsoft error descriptions", () => fixture(async () => {
  mock.method(globalThis, "fetch", async () => Response.json({ error: "unauthorized_client", error_description: "sensitive details" }, { status: 401 }));
  await assert.rejects(new SharePointClient().drive(), error =>
    error instanceof SharePointError && !error.message.includes("sensitive") && !error.message.includes("fixture-secret"));
}));

test("Graph downloads strip authorization and reject unexpected redirect hosts", () => fixture(async () => {
  let calls = 0;
  let unexpectedHost = false;
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    if (String(url).includes("/oauth2/")) return Response.json({ access_token: "test-token", expires_in: 3600 });
    if (String(url).includes("/sites/fixture.sharepoint.com:")) return Response.json({ id: "site" });
    if (String(url).endsWith("/sites/site/drives")) return Response.json({ value: [{ id: "drive", name: "Documents" }] });
    if (String(url).includes(":/content")) return new Response(null, { status: 302, headers: {
      location: unexpectedHost ? "https://untrusted.example/download" : "https://fixture.sharepoint.com/download?secret=hidden",
    } });
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    return new Response("downloaded");
  });
  assert.equal((await new SharePointClient().read(["Application", "file"])).toString(), "downloaded");
  assert.equal(calls, 5);
  unexpectedHost = true;
  await assert.rejects(new SharePointClient().read(["Application", "file"]), /Unexpected SharePoint download host/);
}));

test("Upload sessions use parent item IDs, fail on conflicts, and never forward Graph tokens to upload URLs", () => fixture(async () => {
  const client = new SharePointClient();
  mock.method(client, "drive", async () => "drive");
  mock.method(client, "info", async () => ({ id: "parent", folder: {}, size: 0, eTag: "v1" }));
  let uploaded = false;
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/oauth2/")) return Response.json({ access_token: "server-only-token", expires_in: 3600 });
    if (String(url).includes("/createUploadSession")) {
      assert.match(String(url), /\/items\/parent:\/file:\/createUploadSession$/);
      assert.equal(JSON.parse(String(init?.body)).item["@microsoft.graph.conflictBehavior"], "fail");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer server-only-token");
      return Response.json({ uploadUrl: "https://fixture.sharepoint.com/upload?credential=hidden" });
    }
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    assert.equal(new Headers(init?.headers).get("content-range"), "bytes 0-6/7");
    uploaded = true;
    return Response.json({ id: "created" }, { status: 201 });
  });
  await client.create(["Application", "file"], Buffer.from("fixture"));
  assert.equal(uploaded, true);
}));
