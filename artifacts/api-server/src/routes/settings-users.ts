import { Router, type IRouter } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { AddAccessUserBody, AddAccessUserResponse, ListAccessUsersResponse } from "@workspace/api-zod";
import { allInvitations, allUsers, assertCurrentAdmin, assertRemovable, presentInvitation, presentUser } from "../lib/access-users";
import { CertificateError } from "../lib/certificates";
import { change } from "../lib/audit";
import { externalSettingsChange, withAccessLock } from "../lib/settings-audit";

const router: IRouter = Router();
router.get("/users", async (req, res) => {
  const actor = getAuth(req).userId!;
  const [users, invitations] = await Promise.all([allUsers(), allInvitations()]);
  res.json(ListAccessUsersResponse.parse([...users.map(u => presentUser(u, actor)), ...invitations.map(presentInvitation)]));
});
router.post("/users", async (req, res) => {
  const body = AddAccessUserBody.strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Enter a valid email and employee role." }); return; }
  const input = { ...body.data, email: body.data.email.trim().toLowerCase(), name: body.data.name?.trim() ?? "" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) { res.status(400).json({ error: "Enter a valid email address." }); return; }
  const actor = getAuth(req).userId!;
  const result = await withAccessLock(async store => {
    await assertCurrentAdmin(actor);
    const matches = await clerkClient.users.getUserList({ emailAddress: [input.email], limit: 100 });
    const user = matches.data.find(u => u.emailAddresses.some(e => e.emailAddress.toLowerCase() === input.email));
    if (user) {
      if (user.id === actor && input.role !== "admin") throw new CertificateError(409, "You cannot remove your own administrator role.");
      if (user.banned) throw new CertificateError(409, "This account is disabled by the identity provider.");
      if (!user.emailAddresses.some(e => e.emailAddress.toLowerCase() === input.email && e.verification?.status === "verified")) {
        throw new CertificateError(409, "The existing account must verify this email address before access can be granted.");
      }
      const before = presentUser(user, actor);
      if (before.role === input.role) return before;
      if (before.role === "admin" && input.role !== "admin") assertRemovable(actor, user, await allUsers());
      const updated = await externalSettingsChange({
        action: "Employee role granted", targetId: user.id,
        changes: [change("Email", before.email, before.email), change("Role", before.role, input.role)],
      }, () => clerkClient.users.updateUserMetadata(user.id, { publicMetadata: { role: input.role } }), store);
      return presentUser(updated, actor);
    }
    const duplicate = (await allInvitations()).find(i => i.emailAddress.toLowerCase() === input.email);
    if (duplicate) throw new CertificateError(409, "An invitation is already pending for this email. Remove it before sending a replacement.");
    const invitation = await externalSettingsChange({
      action: "User invited", targetId: input.email,
      changes: [change("Name", null, input.name || null), change("Email", null, input.email), change("Role", null, input.role)],
    }, () => clerkClient.invitations.createInvitation({
      emailAddress: input.email, publicMetadata: { role: input.role, invitedName: input.name },
      ...(req.get("origin") ? { redirectUrl: new URL("/sign-up", req.get("origin")!).href } : {}),
    }), store);
    return presentInvitation(invitation);
  });
  res.status(201).json(AddAccessUserResponse.parse(result));
});
router.delete("/users/:id", async (req, res) => {
  const id = String(req.params.id), actor = getAuth(req).userId!;
  await withAccessLock(async store => {
    await assertCurrentAdmin(actor);
    if (id.startsWith("inv_")) {
      const invitation = (await allInvitations()).find(i => i.id === id);
      if (!invitation) throw new CertificateError(404, "Pending invitation not found.");
      await externalSettingsChange({
        action: "Invitation revoked", targetId: id,
        changes: [change("Email", invitation.emailAddress, invitation.emailAddress), change("Invitation status", "Pending", "Revoked")],
      }, () => clerkClient.invitations.revokeInvitation(id), store);
    } else if (id.startsWith("user_")) {
      const user = await clerkClient.users.getUser(id);
      assertRemovable(actor, user, await allUsers());
      const before = presentUser(user, actor);
      if (!before.role) return;
      await externalSettingsChange({
        action: "Employee access revoked", targetId: id,
        changes: [change("Email", before.email, before.email), change("Role", before.role, null)],
      }, () => clerkClient.users.updateUserMetadata(id, { publicMetadata: { role: null } }), store);
    } else throw new CertificateError(400, "Invalid account ID.");
  });
  res.status(204).end();
});
export default router;
