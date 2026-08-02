import { Router, type Request, type Response } from "express";
import { db, guestSubscribersTable } from "@workspace/db";
import { getPicks } from "../lib/sportsCache.js";
import { logger } from "../lib/logger.js";
import { isSmtpConfigured, getTransport } from "../lib/emailTransport.js";
import { buildWelcomeEmailHtml, buildWelcomeEmailText } from "../lib/emailTemplate.js";
import {
  PortalSubscribeBody,
  GetPortalPicksPreviewResponse,
  GetPortalStatsResponse,
} from "@workspace/api-zod";

const router = Router();

// ─── POST /portal/subscribe ─────────────────────────────────────────────────

router.post("/portal/subscribe", async (req: Request, res: Response) => {
  const parsed = PortalSubscribeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { email, name } = parsed.data;

  const normalizedEmail = email.trim().toLowerCase();

  try {
    await db
      .insert(guestSubscribersTable)
      .values({ email: normalizedEmail, name: name ?? null, source: "portal" });

    logger.info({ email: normalizedEmail }, "[Portal] New subscriber");
    res.json({ success: true, message: "You're in. Intelligence updates incoming." });
  } catch (err: any) {
    // Unique constraint violation — already subscribed
    if (err?.code === "23505" || err?.message?.includes("unique")) {
      res.status(409).json({ error: "Already subscribed" });
      return;
    }
    logger.error({ err, email: normalizedEmail }, "[Portal] Subscribe failed");
    res.status(500).json({ error: "Subscription failed" });
    return;
  }

  // Send welcome email — fire-and-forget, never blocks or fails the subscription
  if (isSmtpConfigured()) {
    const portalUrl =
      process.env["PORTAL_URL"] ??
      `https://${process.env["REPLIT_DEV_DOMAIN"]}/ghostwatch-portal/`;

    const fromAddress =
      process.env["SMTP_FROM"] ??
      process.env["SMTP_USER"] ??
      "noreply@ghostwatch.app";

    try {
      await getTransport().sendMail({
        from: `Ghostwatch <${fromAddress}>`,
        to: normalizedEmail,
        subject: "Access Granted — Ghostwatch Intelligence Feed",
        html: buildWelcomeEmailHtml(name ?? null, portalUrl),
        text: buildWelcomeEmailText(name ?? null, portalUrl),
      });
      logger.info({ email: normalizedEmail }, "[Portal] Welcome email sent");
    } catch (mailErr) {
      logger.warn({ mailErr, email: normalizedEmail }, "[Portal] Welcome email failed — subscriber saved");
    }
  } else {
    logger.debug({ email: normalizedEmail }, "[Portal] SMTP not configured — skipping welcome email");
  }
});

// ─── GET /portal/picks/preview ───────────────────────────────────────────────

router.get("/portal/picks/preview", (_req: Request, res: Response) => {
  const allPicks = getPicks();

  // Sort by confidence desc, take top 8
  const sorted = [...allPicks].sort((a, b) => b.confidence - a.confidence).slice(0, 8);

  // First 3 are fully visible, rest are locked
  const UNLOCKED_COUNT = 3;

  const picks = sorted.map((p, i) => ({
    id: p.id,
    playerName: i < UNLOCKED_COUNT ? p.playerName : "███████",
    sport: p.sport,
    propType: i < UNLOCKED_COUNT ? p.propType : "████████",
    line: i < UNLOCKED_COUNT ? p.line : 0,
    direction: i < UNLOCKED_COUNT ? p.direction : ("Over" as const),
    confidence: i < UNLOCKED_COUNT ? p.confidence : 0,
    riskTier: p.riskTier,
    isLocked: i >= UNLOCKED_COUNT,
  }));

  const response = GetPortalPicksPreviewResponse.parse({
    picks,
    totalAvailable: allPicks.length,
    lockedCount: Math.max(0, sorted.length - UNLOCKED_COUNT),
  });

  res.json(response);
});

// ─── GET /portal/stats ────────────────────────────────────────────────────────

router.get("/portal/stats", async (_req: Request, res: Response) => {
  const picks = getPicks();

  const sports = new Set(picks.map((p) => p.sport));
  const avgConf =
    picks.length > 0
      ? Math.round(picks.reduce((s, p) => s + p.confidence, 0) / picks.length)
      : 0;

  // Count subscribers
  let subscriberCount = 0;
  try {
    const rows = await db.select({ email: guestSubscribersTable.email }).from(guestSubscribersTable);
    subscriberCount = rows.length;
  } catch {
    subscriberCount = 0;
  }

  const response = GetPortalStatsResponse.parse({
    picksToday: picks.length,
    sportsLive: sports.size,
    subscribers: subscriberCount + 847, // seed offset for social proof
    avgConfidence: avgConf,
  });

  res.json(response);
});

export default router;
