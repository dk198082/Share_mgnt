import { Router, type IRouter } from "express";
import { db, sessionsTable, usersTable, signoffsTable } from "@workspace/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { ListDirectoryUsersResponse } from "@workspace/api-zod";
import { buildUserDirectory } from "../lib/user-directory";

// Mounted after the Settings authentication middleware.
const router: IRouter = Router();
router.get("/user-directory", async (req, res): Promise<void> => {
  const profileText = (key: string) => sql<string | null>`${sessionsTable.sess}->'user'->>${key}`;
  const [accounts, sessions, signoffs] = await Promise.all([
    db.select({
      id: usersTable.id, email: usersTable.email,
      firstName: usersTable.firstName, lastName: usersTable.lastName,
    }).from(usersTable),
    db.selectDistinct({
      id: profileText("id"), email: profileText("email"),
      firstName: profileText("firstName"), lastName: profileText("lastName"),
    }).from(sessionsTable).where(and(
      gt(sessionsTable.expire, new Date()),
      eq(sql<string>`${sessionsTable.sess}->>'provider'`, "entra"),
    )),
    db.select({ email: signoffsTable.email }).from(signoffsTable),
  ]);
  const profiles = sessions.filter((s): s is typeof s & { id: string } => Boolean(s.id));
  res.setHeader("Cache-Control", "no-store");
  res.json(ListDirectoryUsersResponse.parse(buildUserDirectory(accounts, profiles, signoffs, req.user!)));
});
export default router;
