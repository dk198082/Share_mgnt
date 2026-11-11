import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const script = await readFile(new URL("./verify-migrated-downloads.browser.js", import.meta.url), "utf8");
const pdf = "%PDF-1.7\nfictional test bytes\n%%EOF";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const images = {
  "image/png": png,
  "image/jpeg": new Uint8Array([255, 216, 255, 224, 0, 2, 255, 217]),
  "image/webp": new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]),
};
const signature = "/objects/uploads/private-signature";
const document = "/objects/uploads/private-document";
const attachment = "/objects/uploads/private-attachment";
const photo = "/objects/uploads/private-photo";
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

async function run(options = {}) {
  const output = [], requests = [];
  const photoType = options.photoType ?? "image/png";
  const documentType = options.documentType ?? "text/plain";
  const documentBytes = documentType === "application/pdf" ? pdf : "Fictional Shareholder — text\r\n";
  const lists = new Map([
    ["/api/certificate-pdfs", [{ id: "private-pdf" }]],
    ["/api/settings/certificate-templates", [{ id: "active", active: true }, { id: "retained", active: false }]],
    ["/api/settings/signoffs", [{ signaturePath: signature }]],
    ["/api/shareholders", options.noShareholderFiles ? [] : [{ name: "DO NOT PRINT ME", picturePath: photo,
      documents: [{ name: documentType === "application/pdf" ? "private.pdf" : "private.txt", objectPath: document,
        size: options.wrongSize ? 99 : Buffer.byteLength(documentBytes) }] }]],
    ["/api/transfers", [{ attachments: [{ name: "private.pdf", objectPath: attachment }] }]],
    ["/api/sign-off-history", [{ approvals: [{ signaturePath: signature }],
      requiredSigners: [{ signaturePath: signature }], input: { attachments: [{ name: "private.pdf", objectPath: attachment }] } }]],
  ]);
  if (options.badReference) lists.set("/api/settings/signoffs", [{ signaturePath: "https://untrusted.example/file" }]);
  const context = vm.createContext({
    location: { origin: options.wrongOrigin ? "https://preview.replit.dev" : "https://shareholder-management.replit.app" },
    console: { log: value => output.push(value) },
    TextDecoder, Uint8Array, AbortSignal,
    fetch: async (path, init) => {
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "error");
      assert.equal(init.cache, "no-store");
      assert.ok(path.startsWith("/api/"));
      requests.push({ path, credentials: init.credentials });
      if (path === "/api/auth/user") return json({ user: options.signedOut ? null : { id: "DO NOT PRINT ME" } });
      if (lists.has(path)) {
        if (path === options.failedList) return json({ error: "sensitive server message" }, 500);
        return json(lists.get(path));
      }
      if (init.credentials === "omit") {
        return options.anonymousAllowed ? new Response(pdf, { headers: { "content-type": "application/pdf" } }) :
          json({ error: "Sign-in required" }, 401);
      }
      if (options.fileFailure) return json({ error: "sensitive object ID" }, 404);
      const image = path.includes("signature") || path.includes("photo");
      const text = path.includes("document");
      const imageType = path.includes("photo") ? photoType : "image/png";
      return new Response(options.invalidBytes ? "<html>bad</html>" : image ? images[imageType] : text ? documentBytes : pdf, {
        headers: { "content-type": image ? imageType : text ? documentType : "application/pdf" },
      });
    },
  });
  await vm.runInContext(script, context);
  assert.equal(output.length, 2);
  const report = JSON.parse(output[1]);
  assert.ok(!output[1].includes("DO NOT PRINT ME"));
  assert.ok(!output[1].includes("private-"));
  assert.ok(!output[1].includes("/api/"));
  return { report, requests };
}

test("checks every category, retained templates and anonymous denial without exposing identifiers", async () => {
  const { report, requests } = await run();
  assert.equal(report.authenticated, true);
  assert.equal(report.inventoryComplete, true);
  assert.equal(report.uniqueFiles, 7);
  assert.equal(report.categories.templates.found, 2);
  assert.equal(report.categories.signatures.found, 1);
  assert.equal(report.failures.length, 0);
  assert.ok(Object.values(report.categories).every(category => category.result === "passed"));
  assert.equal(requests.filter(request => request.credentials === "omit").length, 7);
  assert.equal(report.providerConfirmed, false);
  assert.equal(report.cleanupApproved, false);
});

for (const photoType of Object.keys(images)) {
  for (const documentType of ["application/pdf", "text/plain"]) {
    test(`isolated inventory verifies ${photoType} photos and ${documentType} documents`, async () => {
      const { report, requests } = await run({ photoType, documentType });
      assert.equal(report.failures.length, 0);
      for (const category of ["photos", "documents"]) {
        assert.equal(report.categories[category].found, 1);
        assert.equal(report.categories[category].passed, 1);
        assert.equal(report.categories[category].result, "passed");
      }
      for (const path of [photo, document]) {
        assert.deepEqual(requests.filter(req => req.path === `/api/storage${path}`).map(req => req.credentials),
          ["same-origin", "omit"]);
      }
    });
  }
}

test("empty Shareholder photo/document inventory stays explicitly untested, not passed", async () => {
  const { report, requests } = await run({ noShareholderFiles: true });
  for (const category of ["photos", "documents"]) {
    assert.equal(report.categories[category].found, 0);
    assert.equal(report.categories[category].result, "no references; untested");
  }
  assert.ok(!requests.some(req => req.path.includes("private-photo") || req.path.includes("private-document")));
});

test("wrong host and missing sign-in stop before inventory or file access", async () => {
  assert.equal((await run({ wrongOrigin: true })).requests.length, 0);
  const { report, requests } = await run({ signedOut: true });
  assert.equal(requests.length, 1);
  assert.equal(report.authenticated, false);
  assert.equal(report.inventoryComplete, false);
});

test("incomplete inventory and unsupported external paths never pass", async () => {
  for (const options of [{ failedList: "/api/transfers" }, { badReference: true }]) {
    const { report } = await run(options);
    assert.equal(report.inventoryComplete, false);
    assert.ok(Object.values(report.categories).every(category => category.result === "inventory incomplete"));
  }
});

test("missing files and incorrect format, size or anonymous access are failures", async () => {
  for (const options of [{ fileFailure: true }, { invalidBytes: true }, { wrongSize: true }, { anonymousAllowed: true }]) {
    const { report } = await run(options);
    assert.ok(report.failures.length > 0);
    assert.equal(report.cleanupApproved, false);
    assert.ok(report.failures.every(failure => Number.isInteger(failure.file)));
  }
});
