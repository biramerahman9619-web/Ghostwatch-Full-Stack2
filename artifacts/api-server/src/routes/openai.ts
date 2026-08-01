import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, conversations, messages } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
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
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const router: IRouter = Router();

const GHOSTPHERE_SYSTEM_PROMPT = `You are Ghostphere — an elite AI sports betting intelligence system built into Ghostwatch. You have deep knowledge of:
- Player prop betting (points, rebounds, assists, fantasy scores, passing yards, etc.)
- Risk tier classification: Safe (high confidence, low volatility), Balanced (moderate edge), Aggressive (high ceiling, high variance)
- Reading injury reports, travel schedules, and social sentiment signals
- Analyzing line movement, pace of play, usage rates, and matchup mismatches
- PrizePicks-style prop strategy and multi-pick ticket construction

Your personality: precise, data-driven, direct. You think like a professional handicapper. You back every recommendation with reasoning. No fluff — just signal.

You have access to today's Ghostwatch picks, Ghost Express live signals, Ghostspere ticket recommendations, and Ghostobservation social intel through this conversation. When users ask about specific players, games, or props, analyze them thoroughly. Help users build winning tickets.`;

// List conversations
router.get("/openai/conversations", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(conversations)
    .orderBy(conversations.createdAt);
  res.json(ListOpenaiConversationsResponse.parse(rows.map(r => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }))));
});

// Create conversation
router.post("/openai/conversations", async (req, res): Promise<void> => {
  const parsed = CreateOpenaiConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(conversations)
    .values({ title: parsed.data.title })
    .returning();
  res.status(201).json(CreateOpenaiConversationResponse.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
});

// Get conversation with messages
router.get("/openai/conversations/:id", async (req, res): Promise<void> => {
  const params = GetOpenaiConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.data.id));
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
    messages: msgs.map(m => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
  }));
});

// Delete conversation
router.delete("/openai/conversations/:id", async (req, res): Promise<void> => {
  const params = DeleteOpenaiConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(messages).where(eq(messages.conversationId, params.data.id));
  await db.delete(conversations).where(eq(conversations.id, params.data.id));
  res.sendStatus(204);
});

// List messages
router.get("/openai/conversations/:id/messages", async (req, res): Promise<void> => {
  const params = ListOpenaiMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(messages.createdAt);
  res.json(ListOpenaiMessagesResponse.parse(msgs.map(m => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
  }))));
});

// Send message — streaming SSE
router.post("/openai/conversations/:id/messages", async (req, res): Promise<void> => {
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
  const userContent = parsed.data.content;

  // Save user message
  await db.insert(messages).values({
    conversationId: convId,
    role: "user",
    content: userContent,
  });

  // Load history for context
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(messages.createdAt);

  const chatMessages: ChatCompletionMessageParam[] = [
    { role: "system", content: GHOSTPHERE_SYSTEM_PROMPT },
    ...history.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  const stream = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: 8192,
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
