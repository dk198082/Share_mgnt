export class IdentityLookupError extends Error {
  constructor(public status: 401 | 503, public upstreamStatus?: number) {
    super(status === 401 ? "Your sign-in is no longer active. Please sign in again." : "Sign-in verification is temporarily unavailable. Please retry; this attempt did not change any records.");
    this.name = "IdentityLookupError";
  }
}

/** Retry only an identity READ, never an approval or a remote account mutation.
 * No cross-request cache: revocations and current account roles stay live.
 */
export async function loadEmployeeUser<T>(
  userId: string,
  getUser: (id: string) => Promise<T>,
  pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await getUser(userId); }
    catch (error) {
      const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
      if (status === 404) throw new IdentityLookupError(401, status);
      if (attempt === 0 && (status === undefined || status === 429 || status >= 500)) {
        await pause(250);
        continue;
      }
      throw new IdentityLookupError(503, status);
    }
  }
  throw new IdentityLookupError(503);
}

export function selectVerifiedNotificationEmail(user: {
  emailAddresses: Array<{ id: string; emailAddress: string; verification?: { status?: string } | null }>;
  primaryEmailAddressId: string | null;
}): string | null {
  const verified = user.emailAddresses.filter(email => email.verification?.status === "verified");
  const primary = verified.find(email => email.id === user.primaryEmailAddressId);
  return (primary ?? verified[0])?.emailAddress.trim().toLowerCase() || null;
}
