import { clerkClient } from "@clerk/express";
import { CertificateError } from "./certificates";

export const employeeRoles = ["admin"];
// Compatibility for existing authorized accounts/invitations. These old metadata
// values now confer the single Administrator role, not separate app roles.
export const displayRole = (value: unknown) => typeof value === "string" && ["admin", "hr", "finance", "ceo", "cfo"].includes(value) ? "admin" : null;
type User = Awaited<ReturnType<typeof clerkClient.users.getUser>>;
type Invitation = Awaited<ReturnType<typeof clerkClient.invitations.createInvitation>>;
export function presentUser(user: User, currentId: string) {
  const email = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? "";
  const role = displayRole(user.publicMetadata.role);
  return {
    id: user.id, kind: "account" as const, name: [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      (typeof user.publicMetadata.invitedName === "string" ? user.publicMetadata.invitedName : "") || email,
    email, role, status: role && !user.banned ? "Active" as const : "No access" as const,
    isCurrent: user.id === currentId, createdAt: new Date(user.createdAt).toISOString(),
    lastSignInAt: user.lastSignInAt ? new Date(user.lastSignInAt).toISOString() : null,
  };
}
export function presentInvitation(invitation: Invitation) {
  return {
    id: invitation.id, kind: "invitation" as const,
    name: typeof invitation.publicMetadata?.invitedName === "string" ? invitation.publicMetadata.invitedName : "",
    email: invitation.emailAddress, role: displayRole(invitation.publicMetadata?.role),
    status: "Invited" as const, isCurrent: false, createdAt: new Date(invitation.createdAt).toISOString(), lastSignInAt: null,
  };
}
export async function allUsers() {
  const users: User[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await clerkClient.users.getUserList({ limit: 100, offset });
    users.push(...page.data);
    if (page.data.length < 100 || users.length >= page.totalCount) return users;
  }
}
export async function allInvitations() {
  const invitations: Invitation[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await clerkClient.invitations.getInvitationList({ status: "pending", limit: 100, offset });
    invitations.push(...page.data);
    if (page.data.length < 100 || invitations.length >= page.totalCount) return invitations;
  }
}
// Must be called again inside the access-mutation lock. A previously authorized
// request may have been queued while another administrator removed its access.
export async function assertCurrentAdmin(actorId: string) {
  const user = await clerkClient.users.getUser(actorId);
  if (displayRole(user.publicMetadata.role) !== "admin" || user.banned) throw new CertificateError(403, "Administrator access is no longer active.");
}
export function assertRemovable(actorId: string, target: User, users: User[]) {
  if (actorId === target.id) throw new CertificateError(409, "You cannot remove your own administrator access.");
  if (displayRole(target.publicMetadata.role) === "admin" && users.filter(u => displayRole(u.publicMetadata.role) === "admin" && !u.banned).length <= 1) {
    throw new CertificateError(409, "At least one active administrator must remain.");
  }
}
