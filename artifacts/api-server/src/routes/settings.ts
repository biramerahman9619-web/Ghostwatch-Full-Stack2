import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
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
    riskProfile: row.riskProfile as "Safe" | "Balanced" | "Aggressive",
    picksPerTicket: Number(row.picksPerTicket),
    emailNotifications: row.emailNotifications,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/settings", async (req, res): Promise<void> => {
  const rows = await db.select().from(userSettingsTable).limit(1);
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

  const rows = await db.select().from(userSettingsTable).limit(1);

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
    .where(eq(userSettingsTable.id, rows[0].id))
    .returning();

  res.json(UpdateSettingsResponse.parse(rowToSettings(updated)));
});

export default router;
