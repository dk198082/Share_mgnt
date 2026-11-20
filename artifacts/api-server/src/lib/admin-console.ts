export type ApplicationRole = "viewer" | "editor";
export const ADMIN_CONSOLE_APP_NAME = "Shareholder Management";

type AccessCheckResponse = { allowed: boolean; reason: string | null; roles: string[] };
function parseResponse(value: unknown): AccessCheckResponse | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.allowed !== "boolean" ||
      !(body.reason === null || typeof body.reason === "string") ||
      !Array.isArray(body.roles) || !body.roles.every(role => typeof role === "string")) return null;
  return { allowed: body.allowed, reason: body.reason, roles: body.roles as string[] };
}

export class AdminConsoleAccessError extends Error {
  constructor(readonly kind: "denied" | "unavailable") {
    super(kind === "denied" ? "Application access was not granted." : "Application access could not be verified.");
    this.name = "AdminConsoleAccessError";
  }
}

/** Confirms app assignment and role using the server-only Admin Console key. */
export async function checkAdminConsoleAccess(
  entraObjectId: string,
  fetcher: typeof fetch = fetch,
): Promise<ApplicationRole> {
  const base = process.env.ADMIN_CONSOLE_URL;
  const apiKey = process.env.ADMIN_CONSOLE_API_KEY;
  if (!base?.trim() || !apiKey?.trim()) throw new AdminConsoleAccessError("unavailable");

  let endpoint: URL;
  try {
    endpoint = new URL("/api/access-check", base);
  } catch {
    throw new AdminConsoleAccessError("unavailable");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    throw new AdminConsoleAccessError("unavailable");
  }
  endpoint.searchParams.set("entraObjectId", entraObjectId);
  endpoint.searchParams.set("app", ADMIN_CONSOLE_APP_NAME);

  let result: unknown;
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Admin Console request failed.");
    result = await response.json();
  } catch {
    throw new AdminConsoleAccessError("unavailable");
  }

  const parsed = parseResponse(result);
  if (!parsed) throw new AdminConsoleAccessError("unavailable");
  if (!parsed.allowed) throw new AdminConsoleAccessError("denied");

  const roles = parsed.roles.map(role => role.trim().toLowerCase().replace(/\s+/g, " "));
  const prefix = "(?:shareholder managemen(?:t)? - )?";
  if (roles.some(role => new RegExp(`^${prefix}read\\s*/\\s*write$`).test(role))) return "editor";
  if (roles.some(role => new RegExp(`^${prefix}read only$`).test(role))) return "viewer";
  // An allowed response without a recognized app role is not enough to grant access.
  throw new AdminConsoleAccessError("denied");
}
