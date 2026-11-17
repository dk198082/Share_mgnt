// Entra may provide separate name claims, "First Last", or "Last, First".
// Explicit claims take precedence; parse both display-name formats consistently.
export function profileNames(claims: Record<string, unknown>) {
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
  const display = text(claims.name);
  const comma = display?.indexOf(",") ?? -1;
  const parts = display?.split(/\s+/) ?? [];
  const displayFirst = comma >= 0 ? display!.slice(comma + 1).trim().split(/\s+/)[0] : parts[0];
  const displayLast = comma >= 0 ? display!.slice(0, comma).trim() : parts.slice(1).join(" ");
  const given = text(claims.given_name) ?? text(claims.first_name);
  return {
    firstName: given?.split(/\s+/)[0] || displayFirst || null,
    lastName: text(claims.family_name) ?? text(claims.last_name) ?? (displayLast || null),
  };
}

// Only for an ID token already validated by OIDC and stored in our server-side
// session. This reads display metadata, never authenticates a token or changes
// IDs, emails, verification, permissions, or token-expiry handling.
export function sessionProfileNames(
  user: { id: string; firstName: string | null; lastName: string | null },
  storedIdToken: string | undefined,
  tenantId: string,
) {
  const unchanged = { firstName: user.firstName, lastName: user.lastName };
  if (!storedIdToken || !tenantId) return unchanged;
  try {
    const parts = storedIdToken.split(".");
    if (parts.length !== 3) return unchanged;
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) return unchanged;
    const profile = claims as Record<string, unknown>;
    if (profile.oid !== user.id || typeof profile.tid !== "string" ||
        profile.tid.toLowerCase() !== tenantId.toLowerCase()) return unchanged;
    const names = profileNames(profile);
    return {
      firstName: names.firstName ?? unchanged.firstName,
      lastName: names.lastName ?? unchanged.lastName,
    };
  } catch {
    // Missing/legacy display metadata is not an authentication failure.
    return unchanged;
  }
}
