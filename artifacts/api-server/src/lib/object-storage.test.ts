import assert from "node:assert/strict";
import test from "node:test";
import { ObjectStorageService } from "./objectStorage";

const keys = ["OBJECT_STORAGE_PROVIDER", "AZURE_STORAGE_CONNECTION_STRING", "AZURE_STORAGE_CONTAINER", "PRIVATE_OBJECT_DIR"] as const;
const original = new Map(keys.map(key => [key, process.env[key]]));

function restoreEnv() {
  for (const key of keys) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("Azure upload URLs pass through the authenticated API and keep established object paths", async () => {
  process.env.OBJECT_STORAGE_PROVIDER = "azure";
  process.env.AZURE_STORAGE_CONNECTION_STRING =
    "DefaultEndpointsProtocol=https;AccountName=storagefixture;AccountKey=MDEyMzQ1Njc4OWFiY2RlZg==;EndpointSuffix=core.windows.net";
  process.env.AZURE_STORAGE_CONTAINER = "private-documents";

  try {
    const storage = new ObjectStorageService();
    const uploadURL = await storage.getObjectEntityUploadURL();
    const url = new URL(uploadURL, "https://shareholder.example");
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    assert.match(objectPath, /^\/objects\/uploads\/[0-9a-f-]{36}$/i);
    assert.equal(url.pathname, `/api/storage/${objectPath.slice("/objects/".length)}/content`);
    assert.equal(url.search, "");
  } finally {
    restoreEnv();
  }
});

test("Azure normalization rejects signed URLs for another container", () => {
  process.env.OBJECT_STORAGE_PROVIDER = "azure";
  process.env.AZURE_STORAGE_CONTAINER = "private-documents";
  try {
    assert.throws(() =>
      new ObjectStorageService().normalizeObjectEntityPath(
        "https://storagefixture.blob.core.windows.net/other-container/uploads/file?sig=redacted",
      ),
    );
  } finally {
    restoreEnv();
  }
});

test("legacy Google object links still normalize to their original object paths", () => {
  process.env.OBJECT_STORAGE_PROVIDER = "replit";
  process.env.PRIVATE_OBJECT_DIR = "/legacy-bucket/private";
  try {
    assert.equal(
      new ObjectStorageService().normalizeObjectEntityPath(
        "https://storage.googleapis.com/legacy-bucket/private/uploads/existing-id",
      ),
      "/objects/uploads/existing-id",
    );
  } finally {
    restoreEnv();
  }
});
