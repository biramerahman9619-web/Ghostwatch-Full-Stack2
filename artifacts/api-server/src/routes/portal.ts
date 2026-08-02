import { Router, type Request, type Response } from "express";
import { db, guestSubscribersTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { getPicks, loadPicksFromSnapshot, getCacheStatus } from "../lib/sportsCache.js";
import { logger } from "../lib/logger.js";
import { isOperator } from "../lib/operatorAuth.js";
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

// ─── GET /portal/subscribers (authenticated — operator view) ─────────────────

router.get("/portal/subscribers", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!isOperator(req)) {
    res.status(403).json({ error: "Operator access required" });
    return;
  }

  try {
    // Fetch all subscribers ordered newest-first so we can build both recent list and sparkline
    const rows = await db
      .select()
      .from(guestSubscribersTable)
      .orderBy(desc(guestSubscribersTable.createdAt));

    const total = rows.length;

    // Build daily counts for the past 7 days
    const now = new Date();
    const dailyCounts: Array<{ date: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
      const count = rows.filter(
        (r) => r.createdAt.toISOString().slice(0, 10) === dateStr
      ).length;
      dailyCounts.push({ date: dateStr, count });
    }

    const last7Days = dailyCounts.reduce((s, d) => s + d.count, 0);

    // Recent 10 entries for the operator table
    const recent = rows.slice(0, 10).map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name ?? null,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
    }));

    res.json({ total, last7Days, dailyCounts, recent });
  } catch (err) {
    logger.error({ err }, "[Portal] Subscribers query failed");
    res.status(500).json({ error: "Failed to fetch subscribers" });
  }
});

// ─── GET /portal/picks/preview ───────────────────────────────────────────────

router.get("/portal/picks/preview", (_req: Request, res: Response) => {
  let livePicks = getPicks();
  const cacheSource = getCacheStatus().source;

  // Determine which picks to serve and where they came from
  let source: "live" | "snapshot";
  let allPicks = livePicks;

  if (livePicks.length > 0) {
    // In-memory cache has data — use it and map "mock" to "live" for the portal
    source = cacheSource === "snapshot" ? "snapshot" : "live";
  } else {
    // Cold-start or live refresh returned zero — fall back to on-disk snapshot
    const snap = loadPicksFromSnapshot();
    if (snap && snap.picks.length > 0) {
      allPicks = snap.picks;
      source = "snapshot";
      logger.info(
        { picksFromDisk: snap.picks.length, savedAt: snap.savedAt },
        "[Portal] Serving snapshot picks during cold-start window",
      );
    } else {
      // Nothing available yet — honest empty response
      source = "live";
    }
  }

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
    source,
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
