import { Router, type IRouter } from "express";
import {
  ListTicketsQueryParams,
  ListTicketsResponse,
  SendTicketEmailBody,
  SendTicketEmailResponse,
} from "@workspace/api-zod";
import { getTickets } from "../lib/sportsCache.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/ghostspere/tickets", async (req, res): Promise<void> => {
  const query = ListTicketsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let tickets = [...getTickets()];
  if (query.data.riskTier) {
    tickets = tickets.filter((t) => t.riskTier === query.data.riskTier);
  }

  res.json(ListTicketsResponse.parse(tickets));
});

router.post("/ghostspere/send-email", async (req, res): Promise<void> => {
  const parsed = SendTicketEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, ticketIds, sport } = parsed.data;

  req.log.info({ email, ticketIds, sport }, "Email dispatch requested");

  // In production: connect SMTP/Gmail API here
  // For now, we simulate a successful send
  const ticketCount = ticketIds.length;
  const sportLabel = sport ?? "All Sports";
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  res.json(
    SendTicketEmailResponse.parse({
      success: true,
      message: `Ghostspere dispatched ${ticketCount} ticket${ticketCount !== 1 ? "s" : ""} (${sportLabel}) to ${email} — ${dateLabel}`,
    }),
  );
});

export default router;
