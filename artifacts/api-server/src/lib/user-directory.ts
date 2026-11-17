import type { DirectoryUser } from "@workspace/api-zod";

type Profile = { id: string; email: string | null; firstName: string | null; lastName: string | null };

// Select only profile properties at the SQL boundary. Never pass session tokens
// or cookie/session identifiers into the directory or its response.
export function buildUserDirectory(
  accounts: Profile[],
  sessions: Profile[],
  signoffs: { email: string }[],
  current: Profile,
): DirectoryUser[] {
  const signerEmails = new Set(signoffs.map(s => s.email.trim().toLowerCase()));
  const rows = new Map<string, DirectoryUser>();
  const add = (p: Profile, source: DirectoryUser["source"]) => {
    const id = `${source === "microsoft_session" ? "entra" : "historical"}:${p.id}`;
    const email = p.email?.trim() || null;
    rows.set(id, {
      id,
      name: [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || email || "Name not available",
      email, source,
      isCurrent: source === "microsoft_session" && p.id === current.id,
      // A match is informational only, not an approval/access decision.
      isSignoff: Boolean(email && signerEmails.has(email.toLowerCase())),
    });
  };
  accounts.forEach(a => add(a, "retained_account"));
  sessions.forEach(s => add(s, "microsoft_session"));
  add(current, "microsoft_session");
  // Never join historical and Entra identities by email or display name.
  return [...rows.values()].sort((a, b) =>
    Number(b.isCurrent) - Number(a.isCurrent) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
