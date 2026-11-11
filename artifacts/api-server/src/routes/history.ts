import { Router, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { ListShareholderHistoryQueryParams, ListShareholderHistoryResponse } from "@workspace/api-zod";
import { requireEmployee } from "../middlewares/employee";
import { loadHistoryPage } from "../lib/history";
import { CertificateError } from "../lib/certificates";

const router: IRouter = Router();
router.get("/shareholders/:id/history", requireEmployee, async (req, res) => {
  const shareholderId = String(req.params.id);
  const parsed = ListShareholderHistoryQueryParams.strict().safeParse(req.query);
  if (!shareholderId || shareholderId.length > 200 || !parsed.success) { res.status(400).json({ error: "Invalid history request." }); return; }
  let result;
  try {
    result = await db.transaction(tx => loadHistoryPage(tx, shareholderId, parsed.data.before));
  } catch (error) {
    if (error instanceof CertificateError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
  const page = result.entries;
  // Older summaries stored only the Clerk ID. Resolve those identities where
  // possible, without claiming a current name is an event-time snapshot.
  const names = new Map<string, string>();
  await Promise.all([...new Set(page.filter(r => !r.actorName).map(r => r.actor))].map(async id => {
    if (!id.startsWith("user_")) { names.set(id, id); return; }
    try {
      const user = await clerkClient.users.getUser(id);
      names.set(id, [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress || id);
    } catch { names.set(id, `Former or unavailable employee (${id})`); }
  }));
  res.json(ListShareholderHistoryResponse.parse({
    entries: page.map(r => ({
      id: r.id, action: r.action, actorId: r.actor, actorName: r.actorName ?? names.get(r.actor) ?? r.actor,
      createdAt: r.createdAt.toISOString(), detailed: r.changes !== null, changes: r.changes ?? [],
    })),
    nextCursor: result.nextCursor,
    notice: "Field-level details are recorded for changes made after history tracking was enabled. Earlier entries contain only the original activity summary; employee names on these entries are resolved from the current directory when available. SSN values are never shown.",
  }));
});
export default router;
