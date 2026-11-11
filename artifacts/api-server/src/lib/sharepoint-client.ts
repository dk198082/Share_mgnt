/** Microsoft Graph application access. Tokens and preauthenticated URLs never leave the server. */
export class SharePointError extends Error {
  constructor(public status: number, public code: string) {
    super(`SharePoint request failed (${status}, ${code}).`);
    this.name = "SharePointError";
  }
}

export function sharePointConfig() {
  const keys = ["CLIENT_ID", "CLIENT_SECRET", "TENANT_ID", "SHAREPOINT_HOSTNAME",
    "SHAREPOINT_SITE_PATH", "SHAREPOINT_LIBRARY", "SHAREPOINT_ROOT_FOLDER"] as const;
  if (keys.some(key => !process.env[key]?.trim())) throw new Error("SharePoint storage configuration is incomplete.");
  const hostname = process.env.SHAREPOINT_HOSTNAME!.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-zA-Z0-9.-]+$/.test(hostname)) throw new Error("Invalid SharePoint hostname.");
  const segments = (value: string) => value.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const root = segments(process.env.SHAREPOINT_ROOT_FOLDER!.trim());
  const site = segments(process.env.SHAREPOINT_SITE_PATH!.trim());
  if ([...root, ...site].some(p => p === "." || p === ".." || /[\\:*?"<>|]/.test(p))) {
    throw new Error("Invalid SharePoint folder or site path.");
  }
  return { hostname, root, site, library: process.env.SHAREPOINT_LIBRARY!.trim() };
}

type Item = { id: string; name: string; size: number; eTag: string; folder?: object; file?: { mimeType?: string } };
type JsonPage = { value: Array<{ id: string; name: string }>; "@odata.nextLink"?: string };
const encodePath = (segments: string[]) => segments.map(encodeURIComponent).join("/");
async function boundedBytes(res: Response): Promise<Buffer> {
  if (!res.body) throw new Error("SharePoint returned an empty response body.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw new Error("SharePoint file exceeds the application size limit.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class SharePointClient {
  private token?: { value: string; expires: number };
  private tokenPromise?: Promise<string>;
  private drivePromise?: Promise<string>;
  private folders = new Map<string, Promise<void>>();

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      sharePointConfig();
      const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(process.env.TENANT_ID!)}/oauth2/v2.0/token`, {
        method: "POST", signal: AbortSignal.timeout(30_000),
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.CLIENT_ID!,
          client_secret: process.env.CLIENT_SECRET!, scope: "https://graph.microsoft.com/.default" }),
      });
      const body = await res.json() as { access_token?: string; expires_in?: number };
      if (!res.ok || !body.access_token) throw new SharePointError(res.status, "applicationAuthenticationFailed");
      this.token = { value: body.access_token, expires: Date.now() + Number(body.expires_in ?? 300) * 1000 };
      return this.token.value;
    })();
    try { return await this.tokenPromise; } finally { this.tokenPromise = undefined; }
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    // Only Graph-relative paths are accepted, including pagination links.
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid Graph path.");
    for (let attempt = 0; ; attempt++) {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${await this.accessToken()}`);
      const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
        ...init, headers, redirect: "manual", signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 401 && attempt === 0) { this.token = undefined; continue; }
      if (res.status === 429 && attempt < 3) {
        await res.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, Math.min(10, Number(res.headers.get("retry-after")) || 2) * 1000));
        continue;
      }
      if (res.ok || res.status === 302) return res;
      const body = await res.json().catch(() => ({})) as { error?: { code?: string } };
      const code = body.error?.code;
      throw new SharePointError(res.status, code && /^[a-zA-Z0-9_]+$/.test(code) ? code : "requestFailed");
    }
  }

  async drive(): Promise<string> {
    if (!this.drivePromise) this.drivePromise = (async () => {
      const config = sharePointConfig();
      const suffix = config.site.length ? `:/${encodePath(config.site)}` : "";
      const site = await (await this.request(`/sites/${encodeURIComponent(config.hostname)}${suffix}`)).json() as { id: string };
      let path: string | undefined = `/sites/${encodeURIComponent(site.id)}/drives`;
      while (path) {
        const page = await (await this.request(path)).json() as JsonPage;
        const drive = page.value.find(item => item.id === config.library || item.name === config.library);
        if (drive) return drive.id;
        const next = page["@odata.nextLink"];
        if (next && !next.startsWith("https://graph.microsoft.com/v1.0/")) throw new Error("Invalid Graph pagination origin.");
        path = next?.slice("https://graph.microsoft.com/v1.0".length);
      }
      throw new Error("The configured SharePoint document library was not found.");
    })().catch(error => { this.drivePromise = undefined; throw error; });
    return this.drivePromise;
  }

  private async itemPath(parts: string[]): Promise<string> {
    return `/drives/${encodeURIComponent(await this.drive())}/root:/${encodePath(parts)}`;
  }

  async info(parts: string[]): Promise<Item> {
    return await (await this.request(await this.itemPath(parts))).json() as Item;
  }

  async exists(parts: string[]): Promise<boolean> {
    try { await this.info(parts); return true; }
    catch (error) { if (error instanceof SharePointError && error.status === 404) return false; throw error; }
  }

  async read(parts: string[]): Promise<Buffer> {
    const res = await this.request(`${await this.itemPath(parts)}:/content`);
    if (res.status !== 302) return boundedBytes(res);
    const target = new URL(res.headers.get("location") ?? "");
    // Do not forward the Graph bearer token to the preauthenticated download host.
    if (target.protocol !== "https:" || target.hostname !== sharePointConfig().hostname) {
      throw new Error("Unexpected SharePoint download host.");
    }
    const download = await fetch(target, { redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!download.ok) throw new SharePointError(download.status, "downloadFailed");
    return boundedBytes(download);
  }

  private async ensureFolder(parts: string[]): Promise<void> {
    if (!parts.length) return;
    const key = parts.join("/");
    if (this.folders.has(key)) return this.folders.get(key)!;
    const pending = (async () => {
      try {
        const item = await this.info(parts);
        if (!item.folder) throw new Error("SharePoint storage path is not a folder.");
        return;
      } catch (error) { if (!(error instanceof SharePointError && error.status === 404)) throw error; }
      await this.ensureFolder(parts.slice(0, -1));
      const parent = parts.length === 1
        ? `/drives/${encodeURIComponent(await this.drive())}/root`
        : await this.itemPath(parts.slice(0, -1));
      try {
        await this.request(`${parent}${parts.length === 1 ? "" : ":"}/children`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: parts.at(-1), folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
        });
      } catch (error) {
        if (!(error instanceof SharePointError && error.status === 409)) throw error;
        if (!(await this.info(parts)).folder) throw new Error("SharePoint storage path is not a folder.");
      }
    })().catch(error => { this.folders.delete(key); throw error; });
    this.folders.set(key, pending);
    return pending;
  }

  async create(parts: string[], bytes: Buffer): Promise<void> {
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("SharePoint files must be between 1 byte and 10 MB.");
    await this.ensureFolder(parts.slice(0, -1));
    const parent = await this.info(parts.slice(0, -1));
    const sessionPath = `/drives/${encodeURIComponent(await this.drive())}/items/${encodeURIComponent(parent.id)}:/${encodeURIComponent(parts.at(-1)!)}:/createUploadSession`;
    const session = await (await this.request(sessionPath, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail" } }),
    })).json() as { uploadUrl: string };
    const url = new URL(session.uploadUrl);
    if (url.protocol !== "https:" || url.hostname !== sharePointConfig().hostname) throw new Error("Unexpected SharePoint upload host.");
    const res = await fetch(url, { method: "PUT", redirect: "error", signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/octet-stream", "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}` },
      body: new Uint8Array(bytes),
    });
    if (res.status !== 200 && res.status !== 201) throw new SharePointError(res.status, "uploadFailed");
  }

  async replaceMetadata(parts: string[], bytes: Buffer, etag: string): Promise<void> {
    await this.request(`${await this.itemPath(parts)}:/content`, { method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": etag }, body: new Uint8Array(bytes) });
  }
}

export const sharePointClient = new SharePointClient();
