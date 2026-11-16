/** Explicit HTTPS origin for Azure/custom-domain OIDC callbacks.
 * Kept server-side; request Host headers never select an arbitrary callback. */
export function configuredApplicationOrigin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!env.APP_PUBLIC_ORIGIN) return undefined;
  try {
    const url = new URL(env.APP_PUBLIC_ORIGIN);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new Error("APP_PUBLIC_ORIGIN must be a single HTTPS origin without a path, credentials, query or port."); }
}
