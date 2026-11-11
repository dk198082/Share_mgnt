import type { Request } from "express";

export function getNotificationOrigin(req: Request): string | null {
  const header = req.get("origin");
  if (!header) return null;
  try {
    const origin = new URL(header);
    if (!["https:", "http:"].includes(origin.protocol) ||
        origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash)
      return null;
    if (origin.protocol === "http:" && !["localhost", "127.0.0.1"].includes(origin.hostname))
      return null;
    return origin.origin;
  } catch {
    return null;
  }
}
