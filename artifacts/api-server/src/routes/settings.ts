import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db, userSettingsTable } from "@workspace/db";
import {
  GetSettingsResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const DEFAULT_SETTINGS = {
  id: "default",
  email: "",
  preferredSports: ["NBA", "NFL"],
  riskProfile: "Balanced" as const,
  picksPerTicket: 3,
  emailNotifications: true,
  createdAt: new Date().toISOString(),
};

function rowToSettings(row: {
  id: number;
  email: string;
  preferredSports: string;
  riskProfile: string;
  picksPerTicket: string;
  emailNotifications: boolean;
  createdAt: Date;
}) {
  return {
    id: String(row.id),
    email: row.email,
    preferredSports: row.preferredSports.split(",").filter(Boolean),
    riskProfile: row.riskProfile as "Safe" | "Balanced" | "Aggressive" | "Mixed",
    picksPerTicket: Number(row.picksPerTicket),
    emailNotifications: row.emailNotifications,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Returns the WHERE clause that scopes a settings query to the calling user.
 *  - Authenticated: match rows where user_id = userId
 *  - Unauthenticated: match legacy rows where user_id IS NULL (single-user fallback)
 */
function userFilter(req: Request) {
  const userId = req.isAuthenticated() ? req.user.id : null;
  return userId
    ? eq(userSettingsTable.userId, userId)
    : isNull(userSettingsTable.userId);
}

router.get("/settings", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(userSettingsTable)
    .where(userFilter(req))
    .limit(1);

  if (rows.length === 0) {
    res.json(GetSettingsResponse.parse(DEFAULT_SETTINGS));
    return;
  }
  res.json(GetSettingsResponse.parse(rowToSettings(rows[0])));
});

router.put("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const userId = req.isAuthenticated() ? req.user.id : null;
  const filter = userFilter(req);

  const rows = await db
    .select()
    .from(userSettingsTable)
    .where(filter)
    .limit(1);

  const updates: Record<string, unknown> = {};
  if (data.email !== undefined) updates.email = data.email;
  if (data.preferredSports !== undefined) updates.preferredSports = data.preferredSports.join(",");
  if (data.riskProfile !== undefined) updates.riskProfile = data.riskProfile;
  if (data.picksPerTicket !== undefined) updates.picksPerTicket = String(data.picksPerTicket);
  if (data.emailNotifications !== undefined) updates.emailNotifications = data.emailNotifications;

  if (rows.length === 0) {
    const [inserted] = await db
      .insert(userSettingsTable)
      .values({
        userId: userId ?? null,
        email: (data.email as string) ?? "",
        preferredSports: data.preferredSports?.join(",") ?? "NBA,NFL",
        riskProfile: (data.riskProfile as string) ?? "Balanced",
        picksPerTicket: String(data.picksPerTicket ?? 3),
        emailNotifications: data.emailNotifications ?? true,
      })
      .returning();
    res.json(UpdateSettingsResponse.parse(rowToSettings(inserted)));
    return;
  }

  const [updated] = await db
    .update(userSettingsTable)
    .set(updates)
    .where(filter)
    .returning();

  res.json(UpdateSettingsResponse.parse(rowToSettings(updated)));
});

export default router;
