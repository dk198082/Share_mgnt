import { createHash, randomUUID } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { BlobServiceClient, BlockBlobClient, ContainerClient } from "@azure/storage-blob";
import { File, Storage } from "@google-cloud/storage";
import { SharePointStoredObjectFile } from "./sharepoint-storage";
import { sharePointConfig } from "./sharepoint-client";

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const ACL_METADATA_KEY = "custom:aclPolicy";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export type StoredObjectMetadata = {
  size?: number | string;
  contentType?: string;
  metadata?: Record<string, string>;
  [key: string]: unknown;
};

export interface StoredObjectFile {
  name: string;
  exists(): Promise<[boolean]>;
  getMetadata(): Promise<[StoredObjectMetadata]>;
  createReadStream(options?: { start?: number; end?: number }): Readable;
  download(): Promise<[Buffer]>;
  save(data: Buffer, options?: { contentType?: string; preconditionOpts?: { ifGenerationMatch?: number } }): Promise<unknown>;
  setMetadata(metadata: { metadata?: Record<string, string> }): Promise<unknown>;
}

export class ObjectStorageService {
  getPublicObjectSearchPaths(): Array<string> {
    const paths = Array.from(new Set((process.env.PUBLIC_OBJECT_SEARCH_PATHS || "")
      .split(",").map(path => path.trim()).filter(Boolean)));
    if (!paths.length) {
      throw new Error("PUBLIC_OBJECT_SEARCH_PATHS not set. Configure public object paths before serving public assets.");
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error("PRIVATE_OBJECT_DIR not set. Configure the legacy Replit object directory before using Replit storage.");
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    if (this.provider !== "replit") {
      throw new Error("Public object search paths are not supported by the private Azure document container.");
    }
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const { bucketName, objectName } = parseObjectPath(`${searchPath}/${filePath}`);
      const file = objectStorageClient.bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      if (exists) return file;
    }
    return null;
  }

  async downloadObject(file: File | StoredObjectFile, cacheTtlSec = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";
    const headers: Record<string, string> = {
      "Content-Type": metadata.contentType || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size !== undefined) headers["Content-Length"] = String(metadata.size);
    return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const objectPath = `/objects/uploads/${randomUUID()}`;
    if (this.provider === "sharepoint") {
      sharePointConfig();
      return `/api/storage/${objectPath.slice("/objects/".length)}/content`;
    }
    if (this.provider === "azure") {
      getAzureConfig();
      return `/api/storage/${objectPath.slice("/objects/".length)}/content`;
    }

    const { bucketName, objectName } = parseObjectPath(`${this.getPrivateObjectDir()}${objectPath.slice("/objects".length)}`);
    return signObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 900 });
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredObjectFile> {
    const blobName = blobNameFromObjectPath(objectPath);
    if (this.provider === "sharepoint") {
      const file = new SharePointStoredObjectFile(blobName);
      if (!(await file.exists())[0]) throw new ObjectNotFoundError();
      return file;
    }
    if (this.provider === "azure") {
      const file = new AzureStoredObjectFile(getAzureConfig().container.getBlockBlobClient(blobName));
      const [exists] = await file.exists();
      if (!exists) throw new ObjectNotFoundError();
      return file;
    }
    const { bucketName, objectName } = parseObjectPath(`${this.getPrivateObjectDir().replace(/\/+$/, "")}/${blobName}`);
    const file = wrapGoogleFile(objectStorageClient.bucket(bucketName).file(objectName));
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    const apiUpload = /^\/api\/storage\/uploads\/([^/]+)\/content$/.exec(rawPath);
    if (apiUpload) return `/objects/uploads/${decodeURIComponent(apiUpload[1])}`;

    if (rawPath.startsWith("https://storage.googleapis.com/")) {
      const url = new URL(rawPath);
      const objectEntityDir = `${this.getPrivateObjectDir().replace(/\/+$/, "")}/`;
      if (!url.pathname.startsWith(objectEntityDir)) return url.pathname;
      return `/objects/${url.pathname.slice(objectEntityDir.length)}`;
    }

    if (this.provider === "azure") {
      const url = new URL(rawPath);
      const containerName = process.env.AZURE_STORAGE_CONTAINER;
      const prefix = `/${containerName}/`;
      if (!containerName || !url.pathname.startsWith(prefix)) {
        throw new Error("Azure upload URL does not match the configured private container.");
      }
      return `/objects/${decodeURIComponent(url.pathname.slice(prefix.length))}`;
    }
    return rawPath;
  }

  async putPrivateObject(objectPath: string, bytes: Uint8Array, contentType: string): Promise<void> {
    if (this.provider === "sharepoint") {
      await new SharePointStoredObjectFile(blobNameFromObjectPath(objectPath)).save(Buffer.from(bytes), { contentType });
      return;
    }
    const file = this.provider === "azure"
      ? new AzureStoredObjectFile(getAzureConfig().container.getBlockBlobClient(blobNameFromObjectPath(objectPath)))
      : await this.getObjectEntityFile(objectPath);
    await file.save(Buffer.from(bytes), {
      contentType,
      preconditionOpts: { ifGenerationMatch: 0 },
    });
  }

  async trySetObjectEntityAclPolicy(rawPath: string, aclPolicy: ObjectAclPolicy): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) return normalizedPath;
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  /**
   * Copies one legacy object to Azure without changing its application path.
   * Existing destination bytes are accepted only when their hash and content
   * type exactly match. Source data is never deleted or modified.
   */
  async copyLegacyObjectEntityToAzure(objectPath: string): Promise<{ sha256: string; size: number; contentType: string }> {
    const blobName = blobNameFromObjectPath(objectPath);
    const { bucketName, objectName } = parseObjectPath(`${this.getPrivateObjectDir().replace(/\/+$/, "")}/${blobName}`);
    const source = objectStorageClient.bucket(bucketName).file(objectName);
    const [sourceExists] = await source.exists();
    if (!sourceExists) throw new ObjectNotFoundError();

    const [sourceMetadata] = await source.getMetadata();
    const [sourceBytes] = await source.download();
    const contentType = sourceMetadata.contentType || "application/octet-stream";
    const sourceHash = sha256(sourceBytes);
    const destination = getAzureConfig().container.getBlockBlobClient(blobName);
    const destinationExists = await destination.exists();
    if (!destinationExists) {
      await destination.uploadData(sourceBytes, {
        blobHTTPHeaders: { blobContentType: contentType },
        conditions: { ifNoneMatch: "*" },
      }).catch(async (error: unknown) => {
        // A competing migration may have created the blob. The read-back below
        // decides whether it is safe to continue.
        if (!isAlreadyExists(error)) throw error;
      });
    }

    const [destinationBytes, destinationMetadata] = await Promise.all([
      destination.downloadToBuffer(),
      destination.getProperties(),
    ]);
    if (sha256(destinationBytes) !== sourceHash ||
        (destinationMetadata.contentType || "application/octet-stream") !== contentType) {
      throw new Error(`Azure copy verification failed for object ${objectPath}; source was retained.`);
    }
    return { sha256: sourceHash, size: sourceBytes.length, contentType };
  }

  async verifyAzureContainerIsPrivate(): Promise<void> {
    const properties = await getAzureConfig().container.getProperties();
    if (properties.blobPublicAccess) {
      throw new Error("Azure object container allows anonymous access; migration was stopped without changing source objects.");
    }
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File | StoredObjectFile;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  private get provider(): "azure" | "replit" | "sharepoint" {
    const provider = process.env.OBJECT_STORAGE_PROVIDER?.trim().toLowerCase();
    if (provider && !["azure", "replit", "sharepoint"].includes(provider)) {
      throw new Error("OBJECT_STORAGE_PROVIDER must be replit, azure, or sharepoint.");
    }
    return provider === "sharepoint" ? "sharepoint" : provider === "azure" ? "azure" : "replit";
  }
}

class AzureStoredObjectFile implements StoredObjectFile {
  constructor(private readonly blob: BlockBlobClient) {}

  get name() { return this.blob.name; }

  async exists(): Promise<[boolean]> {
    return [await this.blob.exists()];
  }

  async getMetadata(): Promise<[StoredObjectMetadata]> {
    const properties = await this.blob.getProperties();
    const metadata = { ...(properties.metadata ?? {}) } as Record<string, string>;
    if (metadata.custom_aclpolicy) {
      metadata[ACL_METADATA_KEY] = metadata.custom_aclpolicy;
      delete metadata.custom_aclpolicy;
    }
    return [{
      ...properties,
      size: properties.contentLength,
      contentType: properties.contentType,
      metadata,
    }];
  }

  createReadStream(options?: { start?: number; end?: number }): Readable {
    const stream = new PassThrough();
    const offset = options?.start ?? 0;
    const count = options?.end === undefined ? undefined : options.end - offset + 1;
    void this.blob.download(offset, count).then(response => {
      if (!response.readableStreamBody) throw new Error("Azure returned no object stream.");
      response.readableStreamBody.pipe(stream);
    }).catch(error => stream.destroy(error as Error));
    return stream;
  }

  async download(): Promise<[Buffer]> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.createReadStream()) chunks.push(Buffer.from(chunk));
    return [Buffer.concat(chunks)];
  }

  async save(data: Buffer, options?: { contentType?: string; preconditionOpts?: { ifGenerationMatch?: number } }): Promise<void> {
    await this.blob.uploadData(data, {
      blobHTTPHeaders: { blobContentType: options?.contentType ?? "application/octet-stream" },
      conditions: options?.preconditionOpts?.ifGenerationMatch === 0 ? { ifNoneMatch: "*" } : undefined,
    });
  }

  async setMetadata(input: { metadata?: Record<string, string> }): Promise<void> {
    const metadata = Object.fromEntries(Object.entries(input.metadata ?? {}).map(([key, value]) => [
      key === ACL_METADATA_KEY ? "custom_aclpolicy" : key.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      value,
    ]));
    await this.blob.setMetadata(metadata);
  }
}

function wrapGoogleFile(file: File): StoredObjectFile {
  return {
    name: file.name,
    exists: () => file.exists(),
    getMetadata: async () => {
      const [metadata] = await file.getMetadata();
      return [metadata as StoredObjectMetadata];
    },
    createReadStream: options => file.createReadStream(options),
    download: async () => {
      const [bytes] = await file.download();
      return [bytes];
    },
    save: (data, options) => file.save(data, options),
    setMetadata: metadata => file.setMetadata(metadata),
  };
}

function blobNameFromObjectPath(objectPath: string): string {
  if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
  const name = objectPath.slice("/objects/".length);
  if (!name || name.split("/").some(part => !part || part === "." || part === "..")) {
    throw new ObjectNotFoundError();
  }
  return name;
}

function getAzureConfig(): {
  container: ContainerClient;
} {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = process.env.AZURE_STORAGE_CONTAINER;
  if (!connectionString || !containerName) {
    throw new Error("Azure object storage requires AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER.");
  }
  const container = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(containerName);
  return { container };
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const pathParts = path.split("/");
  if (pathParts.length < 3 || !pathParts[1] || !pathParts.slice(2).join("/")) {
    throw new Error("Invalid object path: expected a bucket and object name.");
  }
  return { bucketName: pathParts[1], objectName: pathParts.slice(2).join("/") };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to sign object URL (status ${response.status}); Replit storage may be unavailable.`);
  }
  const { signed_url: signedURL } = await response.json() as { signed_url: string };
  return signedURL;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isAlreadyExists(error: unknown): boolean {
  const candidate = error as { statusCode?: number; code?: string };
  return candidate.statusCode === 409 || candidate.statusCode === 412 ||
    candidate.code === "BlobAlreadyExists" || candidate.code === "ConditionNotMet";
}
