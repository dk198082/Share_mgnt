import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { StoredObjectFile, StoredObjectMetadata } from "./objectStorage";
import { sharePointClient as client, sharePointConfig, SharePointError } from "./sharepoint-client";

type Manifest = { version: 1; size: number; contentType: string; sha256: string; metadata: Record<string, string> };
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const metadataFolder = ".shareholder-metadata";

export class SharePointStoredObjectFile implements StoredObjectFile {
  private parts: string[];
  private metadataParts: string[];
  constructor(public name: string) {
    const segments = name.split("/");
    if (!name || segments.some(part => !part || part === "." || part === ".." || /[\\:*?"<>|]/.test(part)) ||
        segments[0] === metadataFolder) throw new Error("Invalid SharePoint object path.");
    const root = sharePointConfig().root;
    this.parts = [...root, ...segments];
    this.metadataParts = [...root, metadataFolder, ...segments.slice(0, -1), `${segments.at(-1)}.json`];
  }

  async exists(): Promise<[boolean]> { return [await client.exists(this.parts)]; }

  private async manifest(): Promise<Manifest> {
    const data = JSON.parse((await client.read(this.metadataParts)).toString()) as Manifest;
    if (data.version !== 1 || !Number.isSafeInteger(data.size) || data.size < 1 ||
        typeof data.contentType !== "string" || !/^[a-f0-9]{64}$/.test(data.sha256) ||
        !data.metadata || typeof data.metadata !== "object") throw new Error("Invalid SharePoint file metadata.");
    return data;
  }

  async getMetadata(): Promise<[StoredObjectMetadata]> {
    const [manifest, item] = await Promise.all([this.manifest(), client.info(this.parts)]);
    if (manifest.size !== item.size) throw new Error("SharePoint file size verification failed.");
    return [{ size: manifest.size, contentType: manifest.contentType, metadata: manifest.metadata }];
  }

  async download(): Promise<[Buffer]> {
    const [manifest, bytes] = await Promise.all([this.manifest(), client.read(this.parts)]);
    if (manifest.size !== bytes.length || manifest.sha256 !== hash(bytes)) throw new Error("SharePoint file integrity verification failed.");
    return [bytes];
  }

  createReadStream(options?: { start?: number; end?: number }): Readable {
    const self = this;
    return Readable.from((async function* () {
      const [bytes] = await self.download();
      yield options ? bytes.subarray(options.start ?? 0, options.end === undefined ? undefined : options.end + 1) : bytes;
    })());
  }

  private makeManifest(bytes: Buffer, contentType: string, metadata: Record<string, string> = {}): Manifest {
    return { version: 1, size: bytes.length, contentType, sha256: hash(bytes), metadata };
  }

  async save(bytes: Buffer, options?: { contentType?: string }): Promise<void> {
    if (await client.exists(this.parts)) throw new SharePointError(409, "immutableFileAlreadyExists");
    const manifest = this.makeManifest(bytes, options?.contentType ?? "application/octet-stream");
    await client.create(this.parts, bytes);
    await client.create(this.metadataParts, Buffer.from(JSON.stringify(manifest)));
    await this.download();
  }

  async setMetadata(value: { metadata?: Record<string, string> }): Promise<void> {
    const info = await client.info(this.metadataParts);
    const manifest = await this.manifest();
    manifest.metadata = { ...manifest.metadata, ...value.metadata };
    await client.replaceMetadata(this.metadataParts, Buffer.from(JSON.stringify(manifest)), info.eTag);
  }

  /** Copy-only, resumable import. Never overwrites destination bytes or source data. */
  async importVerified(bytes: Buffer, contentType: string, metadata: Record<string, string> = {}): Promise<void> {
    const expected = this.makeManifest(bytes, contentType, metadata);
    if (await client.exists(this.parts)) {
      const previous = await client.read(this.parts);
      if (hash(previous) !== expected.sha256) throw new Error("SharePoint destination conflicts with the source; nothing was overwritten.");
    } else {
      await client.create(this.parts, bytes);
    }
    if (await client.exists(this.metadataParts)) {
      const previous = await this.manifest();
      if (previous.sha256 !== expected.sha256 || previous.contentType !== contentType || previous.size !== expected.size ||
          JSON.stringify(Object.entries(previous.metadata).sort()) !== JSON.stringify(Object.entries(metadata).sort())) {
        throw new Error("SharePoint destination metadata conflicts with the source; nothing was overwritten.");
      }
    } else {
      await client.create(this.metadataParts, Buffer.from(JSON.stringify(expected)));
    }
    await this.download();
  }
}
