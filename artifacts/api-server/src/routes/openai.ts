import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, conversations, messages, userSettingsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { getPicks, getCacheStatus } from "../lib/sportsCache.js";
import { buildLivePicksContext } from "../lib/openaiContext.js";
import {
  ListOpenaiConversationsResponse,
  CreateOpenaiConversationBody,
  CreateOpenaiConversationResponse,
  GetOpenaiConversationParams,
  GetOpenaiConversationResponse,
  DeleteOpenaiConversationParams,
  ListOpenaiMessagesParams,
  ListOpenaiMessagesResponse,
  SendOpenaiMessageParams,
  SendOpenaiMessageBody,
} from "@workspace/api-zod";

// Local type — avoids importing openai directly from api-server
// (openai package is a dep of @workspace/integrations-openai-ai-server, not api-server)
type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const router: IRouter = Router();

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/** Returns the authenticated user's ID or sends 401 and returns null. */
function requireAuth(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return req.user.id;
}

const GHOSTPHERE_SYSTEM_PROMPT = `You are Ghostphere — an elite AI sports betting intelligence system built into Ghostwatch. You have deep knowledge of:
- Player prop betting (points, rebounds, assists, fantasy scores, passing yards, etc.)
- Risk tier classification: Safe (high confidence, low volatility), Balanced (moderate edge), Aggressive (high ceiling, high variance)
- Reading injury reports, travel schedules, and social sentiment signals
- Analyzing line movement, pace of play, usage rates, and matchup mismatches
- PrizePicks-style prop strategy and multi-pick ticket construction

Your personality: precise, data-driven, direct. You think like a professional handicapper. You back every recommendation with reasoning. No fluff — just signal.

When answering questions about today's picks, use the LIVE GHOSTWATCH DATA block that will be appended to this prompt — it contains the current picks loaded from The Odds API. Help users build winning tickets from this real data.`;

// ─── List conversations (scoped to authenticated user) ────────────────────────

router.get("/openai/conversations", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(conversations.createdAt);

  res.json(ListOpenaiConversationsResponse.parse(rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }))));
});

// ─── Create conversation ──────────────────────────────────────────────────────

router.post("/openai/conversations", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const parsed = CreateOpenaiConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [row] = await db
    .insert(conversations)
    .values({ userId, title: parsed.data.title })
    .returning();

  res.status(201).json(CreateOpenaiConversationResponse.parse({
    ...row,
    createdAt: row!.createdAt.toISOString(),
  }));
});

// ─── Get conversation with messages (ownership-enforced) ─────────────────────

router.get("/openai/conversations/:id", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const params = GetOpenaiConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, params.data.id), eq(conversations.userId, userId)));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(messages.createdAt);

  res.json(GetOpenaiConversationResponse.parse({
    ...conv,
    createdAt: conv.createdAt.toISOString(),
    messages: msgs.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
  }));
});

// ─── Delete conversation (ownership-enforced) ─────────────────────────────────

router.delete("/openai/conversations/:id", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const params = DeleteOpenaiConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const deleted = await db
    .delete(conversations)
    .where(and(eq(conversations.id, params.data.id), eq(conversations.userId, userId)))
    .returning();

  if (!deleted.length) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.status(204).end();
});

// ─── List messages (ownership-enforced) ──────────────────────────────────────

router.get("/openai/conversations/:id/messages", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const params = ListOpenaiMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Verify ownership before listing messages
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, params.data.id), eq(conversations.userId, userId)));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(messages.createdAt);

  res.json(ListOpenaiMessagesResponse.parse(msgs.map((m) => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
  }))));
});

// ─── Send message — streaming SSE (ownership-enforced) ────────────────────────

router.post("/openai/conversations/:id/messages", async (req, res): Promise<void> => {
  const userId = requireAuth(req, res);
  if (!userId) return;

  const params = SendOpenaiMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SendOpenaiMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const convId = params.data.id;

  // Verify ownership before allowing message or model invocation
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, convId), eq(conversations.userId, userId)));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const userContent = parsed.data.content;

  // Save user message first — history and settings can then load in parallel
  await db.insert(messages).values({
    conversationId: convId,
    role: "user",
    content: userContent,
  });

  const [history, settingsRows] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(messages.createdAt),
    db
      .select({
        riskProfile: userSettingsTable.riskProfile,
        picksPerTicket: userSettingsTable.picksPerTicket,
      })
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, userId))
      .limit(1),
  ]);

  const riskProfile = settingsRows[0]?.riskProfile ?? "Balanced";
  const picksPerTicket = settingsRows[0]?.picksPerTicket
    ? Math.min(6, Math.max(3, Number(settingsRows[0].picksPerTicket)))
    : 3;

  const chatMessages: ChatMessage[] = [
    { role: "system", content: GHOSTPHERE_SYSTEM_PROMPT + buildLivePicksContext(getPicks, getCacheStatus, riskProfile, picksPerTicket) },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  const stream = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 4096,
    messages: chatMessages,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      fullResponse += content;
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
  }

  // Save assistant message
  await db.insert(messages).values({
    conversationId: convId,
    role: "assistant",
    content: fullResponse,
  });

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

export default router;
