import { Router, type IRouter, type Request, type Response } from "express";
import nodemailer from "nodemailer";
import { eq, isNull } from "drizzle-orm";
import { db, userSettingsTable } from "@workspace/db";
import {
  ListTicketsQueryParams,
  ListTicketsResponse,
  SendTicketEmailBody,
  SendTicketEmailResponse,
} from "@workspace/api-zod";
import { getPicks } from "../lib/sportsCache.js";
import { buildTicketsFromPicks } from "../lib/picksEngine.js";
import { buildEmailHtml, buildEmailText } from "../lib/emailTemplate.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ─── Auth guard (mirrors openai.ts pattern) ────────────────────────────────────

function requireAuth(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return req.user.id;
}

// ─── Rate limiting (in-memory, per authenticated user) ────────────────────────

const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT = 5; // max sends per window

interface RateBucket {
  count: number;
  windowStart: number;
}

const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);

  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    rateBuckets.set(userId, { count: 1, windowStart: now });
    return true;
  }

  if (bucket.count >= RATE_LIMIT) return false;

  bucket.count += 1;
  return true;
}

// ─── SMTP transport (lazy-initialised so missing creds don't crash startup) ───

let _transport: nodemailer.Transporter | null = null;

function isSmtpConfigured(): boolean {
  return !!(
    process.env["SMTP_HOST"] &&
    process.env["SMTP_USER"] &&
    process.env["SMTP_PASS"]
  );
}

function getTransport(): nodemailer.Transporter {
  if (!_transport) {
    const port = Number(process.env["SMTP_PORT"] ?? "587");
    _transport = nodemailer.createTransport({
      host: process.env["SMTP_HOST"],
      port,
      secure: port === 465,
      auth: {
        user: process.env["SMTP_USER"],
        pass: process.env["SMTP_PASS"],
      },
    });
  }
  return _transport;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/ghostspere/tickets", async (req, res): Promise<void> => {
  const query = ListTicketsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  // Read the user's picksPerTicket + riskProfile settings (auth-aware, mirrors settings route).
  let picksPerTicket = 3;
  let riskProfile: "Safe" | "Balanced" | "Aggressive" | "Mixed" = "Balanced";
  const userId = req.isAuthenticated() ? req.user.id : null;
  const settingsFilter = userId
    ? eq(userSettingsTable.userId, userId)
    : isNull(userSettingsTable.userId);
  const settingsRows = await db
    .select({
      picksPerTicket: userSettingsTable.picksPerTicket,
      riskProfile: userSettingsTable.riskProfile,
    })
    .from(userSettingsTable)
    .where(settingsFilter)
    .limit(1);
  if (settingsRows[0]) {
    if (settingsRows[0].picksPerTicket) {
      picksPerTicket = Math.min(6, Math.max(3, Number(settingsRows[0].picksPerTicket)));
    }
    if (settingsRows[0].riskProfile) {
      riskProfile = settingsRows[0].riskProfile as typeof riskProfile;
    }
  }

  // Generate tickets on-the-fly using the user's profile settings.
  const picks = getPicks();
  const tickets = buildTicketsFromPicks(picks, picksPerTicket, riskProfile);

  res.json(ListTicketsResponse.parse(tickets));
});

router.post("/ghostspere/send-email", async (req, res): Promise<void> => {
  // 1. Require authenticated user
  const userId = requireAuth(req, res);
  if (!userId) return;

  // 2. Rate limit per user (5 sends / 10 min)
  if (!checkRateLimit(userId)) {
    res.status(429).json({
      error: "Too many email dispatches. Please wait before sending again.",
    });
    return;
  }

  const parsed = SendTicketEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { ticketIds, sport } = parsed.data;

  // 3. Load the caller's own settings row — scoped to their userId
  //    This is the authoritative delivery address; the request body email is ignored.
  const rows = await db
    .select()
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);

  const settingsEmail = rows[0]?.email ?? "";
  if (!settingsEmail) {
    res.status(400).json({
      error:
        "No delivery address configured. Set your email in Ghostspere settings first.",
    });
    return;
  }

  req.log.info({ userId, ticketIds, sport }, "Email dispatch requested");

  // Rebuild tickets using the user's current settings — IDs are deterministic
  // (hash of pick IDs) so they match what the /tickets endpoint returned.
  const userRows = await db
    .select({
      picksPerTicket: userSettingsTable.picksPerTicket,
      riskProfile: userSettingsTable.riskProfile,
    })
    .from(userSettingsTable)
    .where(eq(userSettingsTable.userId, userId))
    .limit(1);

  const emailPicksPerTicket = userRows[0]?.picksPerTicket
    ? Math.min(6, Math.max(3, Number(userRows[0].picksPerTicket)))
    : 3;
  const emailRiskProfile = (userRows[0]?.riskProfile ?? "Balanced") as
    | "Safe"
    | "Balanced"
    | "Aggressive"
    | "Mixed";

  const allTickets = buildTicketsFromPicks(getPicks(), emailPicksPerTicket, emailRiskProfile);
  const selectedTickets = allTickets.filter((t) => ticketIds.includes(t.id));

  if (selectedTickets.length === 0) {
    res.status(400).json({ error: "None of the requested ticket IDs were found." });
    return;
  }

  const ticketCount = selectedTickets.length;
  const sportLabel = sport ?? "All Sports";
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  // ── Real SMTP send ──────────────────────────────────────────────────────────
  if (!isSmtpConfigured()) {
    req.log.warn("SMTP credentials not configured — cannot send real email");
    res.status(503).json({
      error:
        "Email delivery is not configured. Add SMTP_HOST, SMTP_USER, and SMTP_PASS as Replit secrets to enable real dispatch.",
    });
    return;
  }

  try {
    const fromAddress =
      process.env["SMTP_FROM"] ??
      `Ghostspere <${process.env["SMTP_USER"]}>`;

    const transport = getTransport();

    await transport.sendMail({
      from: fromAddress,
      to: settingsEmail, // always the caller's server-side setting — never from the request body
      subject: `👻 Ghostspere — ${ticketCount} Pick${ticketCount !== 1 ? "s" : ""} for ${dateLabel}`,
      text: buildEmailText(selectedTickets),
      html: buildEmailHtml(selectedTickets, settingsEmail),
    });

    req.log.info({ userId, ticketCount, to: settingsEmail }, "Email dispatched successfully");

    res.json(
      SendTicketEmailResponse.parse({
        success: true,
        message: `Ghostspere dispatched ${ticketCount} ticket${ticketCount !== 1 ? "s" : ""} (${sportLabel}) to ${settingsEmail} — ${dateLabel}`,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to send email via SMTP");
    res.status(500).json({ error: `Email delivery failed: ${msg}` });
  }
});

export default router;
