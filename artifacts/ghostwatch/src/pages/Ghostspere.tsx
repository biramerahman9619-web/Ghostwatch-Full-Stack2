import {
  useListTickets,
  useSendTicketEmail,
  useGetSettings,
  useUpdateSettings,
  useGetAgentConfig,
  useUpdateAgentConfig,
  useGetAgentStatus,
  useListAgentLog,
  useEvaluateAgentTickets,
  useListPickResults,
  useSettlePickResult,
  getListTicketsQueryKey,
  getGetSettingsQueryKey,
  getGetAgentConfigQueryKey,
  getGetAgentStatusQueryKey,
  getListAgentLogQueryKey,
  getListPickResultsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bot, Mail, Settings2, SplitSquareHorizontal, Shield, ShieldCheck, ShieldOff,
  Zap, Clock, Send, Activity, MessageSquare, TrendingUp, RefreshCw,
  CheckCircle, XCircle, MinusCircle, Radio, CalendarClock, Trophy,
} from "lucide-react";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

// ─── Pick result local type ───────────────────────────────────────────────────
type PickWithResult = {
  pickId: string; playerName: string; team: string; sport: string;
  propType: string; line: number; direction: "Over" | "Under";
  confidence: number; riskTier: string;
  commenceTime: string | null; gameStatus: string;
  homeTeam: string; awayTeam: string;
  homeScore: number | null; awayScore: number | null;
  quarter: string | null; timeRemaining: string | null;
  result: "hit" | "miss" | "push" | null;
  settledValue: string | null;
  settledSource: "espn" | "manual" | null;
  ticketIds: string[];
};

// ─── Multiplier tables ────────────────────────────────────────────────────────
const PP_MULTIPLIERS: Record<number, number> = { 2: 3, 3: 5, 4: 10, 5: 20, 6: 40 };
const FP_MULTIPLIERS: Record<number, number> = { 2: 3, 3: 2.25, 4: 5, 5: 10, 6: 20 };
const FP_BREAKDOWN: Record<number, string> = {
  2: "", 3: "1.25x if 1 miss", 4: "1.5x if 1 miss", 5: "2x if 1 miss · 0.5x if 2", 6: "2x if 1 miss · 0.5x if 2",
};

function entryMultiplier(entryType: string, pickCount: number) {
  return entryType === "FlexPlay" ? FP_MULTIPLIERS[pickCount] ?? 2.25 : PP_MULTIPLIERS[pickCount] ?? 5;
}

// ─── AI confidence badge ──────────────────────────────────────────────────────
function AiBadge({ aiConfidence, reasoning, agentWouldSelect }: { aiConfidence: number; reasoning: string; agentWouldSelect: boolean }) {
  const confidence = aiConfidence;
  const color = confidence >= 80 ? "text-emerald-400 border-emerald-400/40 bg-emerald-400/10"
    : confidence >= 65 ? "text-yellow-400 border-yellow-400/40 bg-yellow-400/10"
    : "text-red-400 border-red-400/40 bg-red-400/10";

  return (
    <div className="mt-2 pt-2 border-t border-border/30 space-y-1">
      <div className="flex items-center gap-2">
        {agentWouldSelect && (
          <Badge className="text-[9px] font-mono uppercase bg-primary/20 text-primary border-primary/40 border px-1.5 py-0 h-auto">
            <ShieldCheck className="w-2.5 h-2.5 mr-0.5" />AGENT PICK
          </Badge>
        )}
        <span className={cn("text-[10px] font-mono border rounded px-1.5 py-0.5 flex items-center gap-1", color)}>
          <Bot className="w-2.5 h-2.5" />{confidence}% AI
        </span>
      </div>
      <p className="text-[9px] text-muted-foreground/70 font-mono leading-relaxed line-clamp-2">{reasoning}</p>
    </div>
  );
}

// ─── Ticket card ──────────────────────────────────────────────────────────────
function TicketCard({ ticket, onSelect, isSelected, evaluation, evalFailed, resultByPickId }: {
  ticket: any; onSelect: () => void; isSelected: boolean;
  evaluation?: { aiConfidence: number; reasoning: string; agentWouldSelect: boolean };
  evalFailed?: boolean;
  resultByPickId: Map<string, "hit" | "miss" | "push">;
}) {
  const isPP = (ticket.entryType ?? "PowerPlay") === "PowerPlay";
  const pickCount = ticket.picks?.length ?? 0;
  const multiplier = ticket.payoutMultiplier ?? entryMultiplier(ticket.entryType ?? "PowerPlay", pickCount);
  const flexNote = !isPP ? FP_BREAKDOWN[pickCount] : "";
  const winPct: number = ticket.winProbability ?? 0;
  const entryColor = isPP ? "border-purple-400/40 text-purple-300" : "border-sky-400/40 text-sky-300";

  // ── Per-pick result counts ──
  const pickResultList = (ticket.picks ?? []).map((p: any) => resultByPickId.get(p.id) ?? null);
  const wonCount  = pickResultList.filter((r: any) => r === "hit").length;
  const lostCount = pickResultList.filter((r: any) => r === "miss").length;
  const pushCount = pickResultList.filter((r: any) => r === "push").length;
  const settledCount = wonCount + lostCount + pushCount;
  const pendingCount = pickCount - settledCount;
  const hasAnyResult = settledCount > 0;

  // ── Ticket outcome ──
  // Miss tolerance derived from the authoritative FP payout schedule (FP_BREAKDOWN):
  //   PP / FP-2 : 0 misses  → full loss on first miss
  //   FP-3 / FP-4 : 1 miss → reduced payout (1.25x / 1.5x)
  //   FP-5 / FP-6 : 2 misses → reduced payout (2x / 0.5x)
  // Pushes void that leg (not a miss, not a hit); they don't count toward the tolerance.
  const fpMissTolerance: number = isPP ? 0
    : pickCount >= 5 ? 2
    : pickCount >= 3 ? 1
    : 0;

  const allSettled = pendingCount === 0 && pickCount > 0;
  let ticketOutcome: "winner" | "loser" | null = null;
  if (allSettled) {
    ticketOutcome = lostCount <= fpMissTolerance ? "winner" : "loser";
  } else if (lostCount > fpMissTolerance) {
    // Miss budget already blown — can't recover regardless of remaining picks
    ticketOutcome = "loser";
  }

  // For FlexPlay winners with misses: indicate reduced payout
  const isReducedFpWin = ticketOutcome === "winner" && !isPP && lostCount > 0;

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all border-2 overflow-hidden",
        isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
        evaluation?.agentWouldSelect && "ring-1 ring-primary/30",
        ticketOutcome === "winner" && "border-emerald-500/60 ring-1 ring-emerald-500/20",
        ticketOutcome === "loser"  && "border-red-500/50 ring-1 ring-red-500/10",
      )}
      onClick={onSelect}
    >
      {/* ── Ticket outcome banner ── */}
      {ticketOutcome && (
        <div className={cn(
          "flex items-center justify-center gap-2 py-1.5 text-[11px] font-mono font-black uppercase tracking-widest",
          ticketOutcome === "winner"
            ? "bg-emerald-500/20 text-emerald-300 border-b border-emerald-500/30"
            : "bg-red-500/15 text-red-400 border-b border-red-500/30",
        )}>
          {ticketOutcome === "winner" ? (
            <>
              <Trophy className="w-3.5 h-3.5" />
              Winner
              {isReducedFpWin && (
                <span className="text-[9px] font-mono font-normal normal-case text-emerald-400/60 ml-0.5">
                  (reduced payout — {lostCount} miss)
                </span>
              )}
            </>
          ) : (
            <><XCircle className="w-3.5 h-3.5" /> No Prize</>
          )}
        </div>
      )}

      <CardContent className="p-4">
        <div className="flex justify-between items-center mb-3 pb-3 border-b border-border/50">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={cn("font-mono uppercase bg-background text-[10px] px-2", entryColor)}>
                {isPP ? "⚡ PP" : "🔄 FP"}
              </Badge>
              <span className="text-xs text-muted-foreground font-mono">{ticket.sport}</span>
            </div>
            {flexNote && <span className="text-[9px] font-mono text-muted-foreground/60">{flexNote}</span>}
          </div>
          <div className="text-right flex gap-3">
            <div>
              <div className="text-[10px] font-mono text-muted-foreground uppercase">Payout</div>
              <div className={cn("font-mono font-bold text-xl", isPP ? "text-purple-300" : "text-sky-300")}>{multiplier}x</div>
            </div>
            <div className="pl-2 border-l border-border/40">
              <div className="text-[10px] font-mono text-muted-foreground uppercase">Win%</div>
              <div className={cn("font-mono font-bold text-xl", winPct >= 55 ? "text-emerald-400" : winPct >= 35 ? "text-yellow-400" : "text-red-400")}>
                {winPct.toFixed(0)}%
              </div>
            </div>
          </div>
        </div>

        {/* ── Per-pick list with result dots ── */}
        <div className="space-y-2">
          {(ticket.picks ?? []).map((pick: any, i: number) => {
            const res = resultByPickId.get(pick.id) ?? null;
            return (
              <div key={i} className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  {/* Result indicator dot */}
                  {res === "hit"  && <CheckCircle  className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                  {res === "miss" && <XCircle      className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                  {res === "push" && <MinusCircle  className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
                  {!res           && <div className="w-3.5 h-3.5 rounded-full border border-border/30 flex-shrink-0 bg-secondary/30" />}
                  <span className={cn("font-bold truncate",
                    res === "hit"  ? "text-emerald-300" :
                    res === "miss" ? "text-red-300 line-through opacity-60" :
                    ""
                  )}>{pick.playerName}</span>
                  <span className="text-muted-foreground shrink-0 text-[10px]">{pick.propType}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-1">
                  <span className="text-[10px] font-mono text-muted-foreground">{pick.confidence}%</span>
                  <span className={cn("font-mono font-medium text-[11px]",
                    res === "hit"  ? "text-emerald-400" :
                    res === "miss" ? "text-red-400" :
                    "text-primary"
                  )}>{pick.direction === "Over" ? "O" : "U"} {pick.line}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Result summary bar ── */}
        {hasAnyResult && (
          <div className="mt-2 pt-2 border-t border-border/30 flex items-center gap-2 flex-wrap">
            {wonCount  > 0 && <span className="text-[9px] font-mono font-bold text-emerald-400">{wonCount} Won</span>}
            {lostCount > 0 && <span className="text-[9px] font-mono font-bold text-red-400">{lostCount} Lost</span>}
            {pushCount > 0 && <span className="text-[9px] font-mono font-bold text-amber-400">{pushCount} Push</span>}
            {pendingCount > 0 && (
              <>
                {settledCount > 0 && <span className="text-muted-foreground/30">·</span>}
                <span className="text-[9px] font-mono text-muted-foreground/50">{pendingCount} pending</span>
              </>
            )}
          </div>
        )}

        {/* ── AI eval section (unchanged) ── */}
        {evaluation
          ? <AiBadge {...evaluation} />
          : evalFailed
            ? <div className="mt-2 pt-2 border-t border-border/30">
                <span className="text-[9px] font-mono text-muted-foreground/50">AI eval unavailable</span>
              </div>
            : <div className="mt-2 pt-2 border-t border-border/30">
                <div className="h-3 bg-secondary/30 rounded animate-pulse w-3/4" />
              </div>
        }
      </CardContent>
    </Card>
  );
}

// ─── Mission log entry ────────────────────────────────────────────────────────
const ACTION_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  scheduled_dispatch: { icon: <Clock className="w-3 h-3" />, color: "text-primary", label: "Scheduled" },
  signal_dispatch:    { icon: <Zap className="w-3 h-3" />, color: "text-yellow-400", label: "Signal" },
  chat_dispatch:      { icon: <MessageSquare className="w-3 h-3" />, color: "text-sky-400", label: "Command" },
  skipped:            { icon: <Activity className="w-3 h-3" />, color: "text-muted-foreground", label: "Skipped" },
  evaluation:         { icon: <Bot className="w-3 h-3" />, color: "text-purple-400", label: "Evaluated" },
};

function LogEntry({ entry }: { entry: any }) {
  const meta = ACTION_META[entry.action] ?? ACTION_META.evaluation!;
  const time = new Date(entry.createdAt);
  const relTime = (() => {
    const diff = (Date.now() - time.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return time.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  })();

  return (
    <div className="flex gap-2 py-2 border-b border-border/30 last:border-0">
      <div className={cn("flex-shrink-0 w-5 h-5 rounded flex items-center justify-center bg-secondary/50 mt-0.5", meta.color)}>
        {meta.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <span className={cn("text-[10px] font-mono uppercase tracking-wide font-bold", meta.color)}>{meta.label}</span>
          <span className="text-[9px] font-mono text-muted-foreground flex-shrink-0">{relTime}</span>
        </div>
        <p className="text-[10px] text-muted-foreground/80 font-mono leading-relaxed line-clamp-2 mt-0.5">{entry.reason}</p>
        {entry.dispatchCount > 0 && (
          <span className="text-[9px] font-mono text-primary mt-0.5 inline-block">
            ↑ {entry.dispatchCount} entr{entry.dispatchCount !== 1 ? "ies" : "y"} sent
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Pick result row ──────────────────────────────────────────────────────────
function GameStatusBadge({ status }: { status: string }) {
  if (status === "Live") return (
    <span className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wide text-rose-400 border border-rose-400/30 rounded px-1.5 py-0.5 bg-rose-400/10">
      <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />LIVE
    </span>
  );
  if (status === "Halftime") return (
    <span className="text-[9px] font-mono font-bold uppercase tracking-wide text-amber-400 border border-amber-400/30 rounded px-1.5 py-0.5 bg-amber-400/10">HT</span>
  );
  if (status === "Final") return (
    <span className="text-[9px] font-mono font-bold uppercase tracking-wide text-muted-foreground border border-border/40 rounded px-1.5 py-0.5">FINAL</span>
  );
  return null; // Upcoming — time shown separately
}

function GameTimeDisplay({ commenceTime }: { commenceTime: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!commenceTime) return null;
  const gt = new Date(commenceTime).getTime();
  const diff = Math.floor((gt - now) / 1000);
  let label: string;
  if (diff <= 0) {
    label = "started";
  } else if (diff < 3600) {
    const m = Math.floor(diff / 60);
    label = `in ${m}m`;
  } else if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    label = m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
  } else {
    label = new Date(commenceTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  }
  return (
    <span className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/80">
      <CalendarClock className="w-3 h-3" />{label}
    </span>
  );
}

function PickResultRow({ pick, onSettle }: {
  pick: PickWithResult;
  onSettle: (pickId: string, result: "hit" | "miss" | "push" | null) => void;
}) {
  const isLive = pick.gameStatus === "Live" || pick.gameStatus === "Halftime";
  const isFinal = pick.gameStatus === "Final";
  const hasScore = pick.homeScore !== null && pick.awayScore !== null;
  const result = pick.result;
  const isWon  = result === "hit";
  const isLost = result === "miss";
  const isPush = result === "push";

  // Format the settled stat display: "27 Pts" / "3 REB" etc.
  const statLine = pick.settledValue != null
    ? `Actual: ${pick.settledValue} (${pick.direction} ${pick.line})`
    : null;

  return (
    <div className={cn(
      "rounded-xl border transition-all overflow-hidden",
      isLive  && !result ? "border-rose-400/30 bg-rose-400/5"   : "",
      isFinal && !result ? "border-border/60 bg-card/50"         : "",
      !isFinal && !isLive && !result ? "border-border/40 bg-card/30" : "",
      isWon  ? "border-emerald-500/50 bg-emerald-500/8"  : "",
      isLost ? "border-red-500/50 bg-red-500/8"          : "",
      isPush ? "border-amber-400/40 bg-amber-400/8"      : "",
    )}>
      {/* ── WON / LOST / PUSH result banner ── */}
      {result && (
        <div className={cn(
          "flex items-center justify-between px-4 py-2.5 border-b",
          isWon  ? "bg-emerald-500/15 border-emerald-500/30" : "",
          isLost ? "bg-red-500/15 border-red-500/30"         : "",
          isPush ? "bg-amber-400/15 border-amber-400/30"     : "",
        )}>
          <div className="flex items-center gap-2">
            {isWon  && <><CheckCircle  className="w-5 h-5 text-emerald-400" /><span className="text-base font-black tracking-wide text-emerald-400 uppercase">Won ✓</span></>}
            {isLost && <><XCircle      className="w-5 h-5 text-red-400"     /><span className="text-base font-black tracking-wide text-red-400 uppercase">Lost ✗</span></>}
            {isPush && <><MinusCircle  className="w-5 h-5 text-amber-400"   /><span className="text-base font-black tracking-wide text-amber-400 uppercase">Push ~</span></>}
            {statLine && (
              <span className={cn("text-[10px] font-mono ml-1",
                isWon ? "text-emerald-400/70" : isLost ? "text-red-400/70" : "text-amber-400/70"
              )}>{statLine}</span>
            )}
            {pick.settledSource === "espn" && (
              <span className="text-[8px] font-mono text-muted-foreground/40 ml-1 border border-border/30 rounded px-1 py-0.5">ESPN</span>
            )}
          </div>
          <button
            onClick={() => onSettle(pick.pickId, null)}
            className="text-[9px] font-mono text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            title="Clear result"
          >✕ clear</button>
        </div>
      )}

      {/* ── Pick detail row ── */}
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Left: status + score block */}
        <div className="w-20 flex-shrink-0 flex flex-col items-center gap-1.5 pt-0.5">
          <GameStatusBadge status={pick.gameStatus} />
          {pick.gameStatus === "Upcoming" && <GameTimeDisplay commenceTime={pick.commenceTime} />}
          {hasScore && (
            <div className="text-[10px] font-mono font-bold text-foreground text-center leading-tight mt-0.5">
              <div className="truncate max-w-[76px]" title={pick.homeTeam}>{pick.homeTeam.split(" ").pop()}</div>
              <div className="text-base font-bold text-foreground">{pick.homeScore} – {pick.awayScore}</div>
              <div className="truncate max-w-[76px]" title={pick.awayTeam}>{pick.awayTeam.split(" ").pop()}</div>
              {pick.quarter && <div className="text-[9px] text-muted-foreground">{pick.quarter}{pick.timeRemaining ? ` · ${pick.timeRemaining}` : ""}</div>}
            </div>
          )}
        </div>

        {/* Middle: pick info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={cn("font-bold text-sm",
              isWon ? "text-emerald-300" : isLost ? "text-red-300" : "text-foreground"
            )}>{pick.playerName}</span>
            <span className="text-[10px] font-mono text-muted-foreground border border-border/40 rounded px-1.5 py-0.5">{pick.sport}</span>
            <span className={cn("text-[9px] font-mono border rounded px-1.5 py-0.5",
              pick.riskTier === "Safe"       ? "border-emerald-400/30 text-emerald-400/80" :
              pick.riskTier === "Aggressive" ? "border-rose-400/30 text-rose-400/80"       :
                                               "border-blue-400/30 text-blue-400/80"
            )}>{pick.riskTier}</span>
          </div>
          <div className="text-xs font-mono text-muted-foreground mb-1">
            {pick.propType} · {pick.direction === "Over" ? "↑ Over" : "↓ Under"}{" "}
            <span className={cn("font-bold", isWon ? "text-emerald-400" : isLost ? "text-red-400" : "text-primary")}>
              {pick.line}
            </span>
          </div>
          <div className="text-[9px] font-mono text-muted-foreground/60 truncate">
            {pick.homeTeam} vs {pick.awayTeam}
          </div>
        </div>

        {/* Right: confidence + manual settle buttons (only when no result yet) */}
        <div className="flex-shrink-0 flex flex-col items-end gap-2">
          <span className={cn("text-[10px] font-mono font-bold",
            pick.confidence >= 80 ? "text-emerald-400" : pick.confidence >= 65 ? "text-yellow-400" : "text-muted-foreground"
          )}>{pick.confidence}%</span>

          {!result && (isFinal || isLive) && (
            <div className="flex flex-col gap-1">
              <button onClick={() => onSettle(pick.pickId, "hit")}
                className="text-[9px] font-mono px-2 py-1 rounded border border-emerald-400/30 text-emerald-400/70 hover:bg-emerald-400/15 hover:text-emerald-400 hover:border-emerald-400/60 transition-colors">
                ✓ Won
              </button>
              <button onClick={() => onSettle(pick.pickId, "miss")}
                className="text-[9px] font-mono px-2 py-1 rounded border border-red-400/30 text-red-400/70 hover:bg-red-400/15 hover:text-red-400 hover:border-red-400/60 transition-colors">
                ✗ Lost
              </button>
              <button onClick={() => onSettle(pick.pickId, "push")}
                className="text-[9px] font-mono px-2 py-1 rounded border border-amber-400/30 text-amber-400/70 hover:bg-amber-400/15 hover:text-amber-400 hover:border-amber-400/60 transition-colors">
                ~ Push
              </button>
            </div>
          )}
          {!result && !isFinal && !isLive && (
            <span className="text-[9px] font-mono text-muted-foreground/30">pre-game</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Ghostspere() {
  const { data: tickets, isLoading: loadingTickets } = useListTickets();
  const { data: settings } = useGetSettings();
  const { data: agentConfig } = useGetAgentConfig();
  const { data: agentStatus } = useGetAgentStatus({ query: { queryKey: getGetAgentStatusQueryKey(), refetchInterval: 30_000 } });
  const { data: agentLog } = useListAgentLog({ query: { queryKey: getListAgentLogQueryKey(), refetchInterval: 30_000 } });
  const evaluateMutation = useEvaluateAgentTickets();
  const sendEmail = useSendTicketEmail();
  const updateSettings = useUpdateSettings();
  const updateConfig = useUpdateAgentConfig();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Settings state ──
  const [editEmail, setEditEmail] = useState("");
  const [editRisk, setEditRisk] = useState<"Safe" | "Balanced" | "Aggressive" | "Mixed">("Balanced");
  const [editEntryType, setEditEntryType] = useState<"PowerPlay" | "FlexPlay">("PowerPlay");
  const [editPicks, setEditPicks] = useState(3);

  // ── Agent config state ──
  const [editScheduleHour, setEditScheduleHour] = useState(8);
  const [editThreshold, setEditThreshold] = useState(75);
  const [editSignalWatch, setEditSignalWatch] = useState(true);
  const [editMaxPerDay, setEditMaxPerDay] = useState(3);

  // ── Center view toggle ──
  const [centerView, setCenterView] = useState<"entries" | "results">("entries");

  // ── Pick results ──
  const { data: pickResults, isLoading: loadingResults, refetch: refetchResults } =
    useListPickResults({ query: { queryKey: getListPickResultsQueryKey(), refetchInterval: 60_000 } });
  const settleResult = useSettlePickResult();

  // Build a fast lookup: pickId → result (used by TicketCard in the entries grid)
  const resultByPickId = useMemo<Map<string, "hit" | "miss" | "push">>(() => {
    const map = new Map<string, "hit" | "miss" | "push">();
    for (const p of (pickResults ?? [])) {
      if (p.result) map.set(p.pickId, p.result as "hit" | "miss" | "push");
    }
    return map;
  }, [pickResults]);

  const handleSettle = useCallback((pickId: string, result: "hit" | "miss" | "push" | null) => {
    if (result === null) {
      // Clear via POST null — server requires auth, will 401 silently if not logged in
      settleResult.mutate({ pickId, data: { result: null as any } }, { onSuccess: () => refetchResults() });
    } else {
      settleResult.mutate({ pickId, data: { result } }, { onSuccess: () => refetchResults() });
    }
  }, [settleResult, refetchResults]);

  // ── Ticket state ──
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set());
  const [evaluations, setEvaluations] = useState<Map<string, { aiConfidence: number; reasoning: string; agentWouldSelect: boolean }>>(new Map());
  const [evalFailed, setEvalFailed] = useState(false);

  // ── Chat state ──
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "agent"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Sync settings ──
  useEffect(() => {
    if (settings) {
      setEditEmail(settings.email || "");
      setEditRisk((settings.riskProfile as any) || "Balanced");
      setEditEntryType((settings.entryType as any) || "PowerPlay");
      setEditPicks(settings.picksPerTicket || 3);
    }
  }, [settings]);

  // ── Sync agent config ──
  useEffect(() => {
    if (agentConfig) {
      setEditScheduleHour(agentConfig.scheduleHour ?? 8);
      setEditThreshold(agentConfig.confidenceThreshold ?? 75);
      setEditSignalWatch(agentConfig.signalWatchEnabled ?? true);
      setEditMaxPerDay(agentConfig.maxPerDay ?? 3);
    }
  }, [agentConfig]);

  // ── Run AI evaluation when tickets load ──
  const runEvaluation = useCallback(() => {
    if (!tickets || tickets.length === 0) return;
    setEvalFailed(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evaluateMutation.mutate(undefined as any, {
      onSuccess: (data: any) => {
        const map = new Map<string, { aiConfidence: number; reasoning: string; agentWouldSelect: boolean }>();
        for (const ev of data?.evaluations ?? []) {
          map.set(ev.ticketId, ev);
        }
        setEvaluations(map);
        setEvalFailed(false);
      },
      onError: () => {
        setEvalFailed(true);
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets?.length]);

  useEffect(() => {
    runEvaluation();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets?.length]);

  // ── Scroll chat to bottom ──
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  // ── Handlers ──
  const handleToggleTicket = (id: string) => {
    const next = new Set(selectedTickets);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedTickets(next);
  };

  const handleSend = () => {
    if (selectedTickets.size === 0) return;
    if (!settings?.email) {
      toast({ title: "No delivery address", description: "Set your email in the settings panel.", variant: "destructive" });
      return;
    }
    sendEmail.mutate({ data: { email: settings.email, ticketIds: Array.from(selectedTickets) } }, {
      onSuccess: (data: any) => {
        const skipped: number = data?.skipped ?? 0;
        const dispatched: number = data?.dispatched ?? selectedTickets.size;
        toast({
          title: skipped > 0 ? `${dispatched} entries dispatched` : "Entries dispatched",
          description: skipped > 0 ? `${skipped} expired and were skipped.` : `Sent to ${settings?.email}`,
          className: "border-primary bg-card text-primary font-mono",
        });
        if (skipped > 0) queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
        setSelectedTickets(new Set());
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? err?.message ?? "Unknown error";
        toast({ title: "Dispatch failed", description: msg, variant: "destructive" });
      },
    });
  };

  const handleSaveSettings = () => {
    updateSettings.mutate(
      { data: { email: editEmail, picksPerTicket: editPicks } },
      {
        onSuccess: () => {
          toast({ title: "Delivery settings saved", className: "border-primary bg-card text-primary font-mono" });
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
        },
        onError: (err: any) => toast({ title: "Save failed", description: err?.response?.data?.error ?? err?.message, variant: "destructive" }),
      },
    );
  };

  // Auto-save entry type immediately on selection
  const handleSelectEntryType = (t: "PowerPlay" | "FlexPlay") => {
    setEditEntryType(t);
    setEvaluations(new Map());
    setEvalFailed(false);
    updateSettings.mutate(
      { data: { entryType: t as any } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
        },
      },
    );
  };

  // Auto-save risk profile immediately on selection
  const handleSelectRisk = (r: "Safe" | "Balanced" | "Aggressive" | "Mixed") => {
    setEditRisk(r);
    setEvaluations(new Map());
    setEvalFailed(false);
    updateSettings.mutate(
      { data: { riskProfile: r as any } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
        },
      },
    );
  };

  const handleToggleArmed = () => {
    const newEnabled = !agentConfig?.enabled;
    updateConfig.mutate(
      { data: { enabled: newEnabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAgentConfigQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAgentStatusQueryKey() });
          toast({ title: newEnabled ? "🛡️ Agent ARMED" : "Agent disarmed", className: "border-primary bg-card text-primary font-mono" });
        },
      },
    );
  };

  const handleSaveAgentConfig = () => {
    updateConfig.mutate(
      { data: { scheduleHour: editScheduleHour, confidenceThreshold: editThreshold, signalWatchEnabled: editSignalWatch, maxPerDay: editMaxPerDay } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAgentConfigQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAgentStatusQueryKey() });
          toast({ title: "Agent config saved", className: "border-primary bg-card text-primary font-mono" });
        },
        onError: (err: any) => toast({ title: "Config save failed", description: err?.response?.data?.error ?? err?.message, variant: "destructive" }),
      },
    );
  };

  const handleChat = useCallback(async () => {
    if (!chatInput.trim() || chatStreaming) return;
    const msg = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    setChatStreaming(true);

    const agentMsgIdx = chatMessages.length + 1;
    setChatMessages((prev) => [...prev, { role: "agent", content: "" }]);

    try {
      const resp = await fetch("/api/ghostspere/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: msg }),
      });

      if (!resp.ok || !resp.body) throw new Error("Chat request failed");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = JSON.parse(line.slice(6));
          if (json.done) break;
          if (json.content) {
            setChatMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === "agent") last.content += json.content;
              return updated;
            });
          }
        }
      }

      // Refresh status and log after chat actions
      queryClient.invalidateQueries({ queryKey: getGetAgentStatusQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListAgentLogQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetAgentConfigQueryKey() });
    } catch (err) {
      setChatMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === "agent" && !last.content) last.content = "Signal lost — please try again.";
        return updated;
      });
    } finally {
      setChatStreaming(false);
    }
  }, [chatInput, chatStreaming, chatMessages.length, queryClient]);

  const isArmed = agentConfig?.enabled ?? false;
  const nextRunAt = agentStatus?.nextRunAt ? new Date(agentStatus.nextRunAt) : null;
  const nextRunLabel = nextRunAt
    ? nextRunAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    : "--";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-border bg-card px-6 py-4 flex-shrink-0 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Bot className="w-6 h-6 text-primary" />
            {isArmed && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse" />
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              Ghostspere
              <Badge variant="outline" className={cn(
                "text-[10px] font-mono uppercase px-2 border",
                isArmed ? "border-emerald-400/50 text-emerald-400 bg-emerald-400/10" : "border-muted-foreground/30 text-muted-foreground"
              )}>
                {isArmed ? "● ARMED" : "○ IDLE"}
              </Badge>
            </h1>
            <p className="text-xs text-muted-foreground font-mono">Autonomous Entry Dispatch Agent</p>
          </div>
        </div>
        <Button
          onClick={handleSend}
          disabled={selectedTickets.size === 0 || sendEmail.isPending}
          className="font-mono uppercase tracking-widest gap-2 text-xs"
        >
          <Mail className="w-3.5 h-3.5" />
          {sendEmail.isPending ? "Dispatching..." : `Manual Dispatch (${selectedTickets.size})`}
        </Button>
      </header>

      {/* ── 3-Panel Body ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── LEFT: Agent Control ─────────────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 border-r border-border overflow-y-auto bg-card/30">
          <div className="p-4 space-y-5">

            {/* ARM toggle */}
            <div>
              <div className="text-[10px] uppercase font-mono text-muted-foreground tracking-widest mb-2">Agent Status</div>
              <button
                onClick={handleToggleArmed}
                disabled={updateConfig.isPending}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2.5 rounded-md border font-mono text-sm font-bold uppercase tracking-widest transition-all",
                  isArmed
                    ? "bg-emerald-500/10 border-emerald-400/50 text-emerald-400 hover:bg-emerald-500/20"
                    : "bg-secondary/50 border-border text-muted-foreground hover:text-foreground hover:border-primary/30",
                )}
              >
                <span className="flex items-center gap-2">
                  {isArmed ? <ShieldCheck className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
                  {isArmed ? "Armed" : "Disarmed"}
                </span>
                <span className="text-[9px] font-normal normal-case tracking-normal text-right">
                  {isArmed ? "Click to disarm" : "Click to arm"}
                </span>
              </button>
            </div>

            {/* Next run */}
            {isArmed && (
              <div className="bg-secondary/30 border border-border/50 rounded-md px-3 py-2">
                <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mb-0.5">Next Scheduled Run</div>
                <div className="flex items-center gap-1.5 text-primary font-mono text-sm font-bold">
                  <Clock className="w-3.5 h-3.5" />{nextRunLabel}
                </div>
              </div>
            )}

            {/* Schedule hour */}
            <div>
              <label className="text-[10px] uppercase font-mono text-muted-foreground tracking-widest mb-1.5 block">
                Daily Dispatch Hour (UTC {editScheduleHour}:00)
              </label>
              <input
                type="range" min={0} max={23} value={editScheduleHour}
                onChange={(e) => setEditScheduleHour(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-0.5">
                <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>11 PM</span>
              </div>
            </div>

            {/* Confidence threshold */}
            <div>
              <label className="text-[10px] uppercase font-mono text-muted-foreground tracking-widest mb-1.5 block">
                Min AI Confidence ({editThreshold}%)
              </label>
              <input
                type="range" min={50} max={95} step={5} value={editThreshold}
                onChange={(e) => setEditThreshold(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[9px] font-mono text-muted-foreground mt-0.5">
                <span>50%</span><span>70%</span><span>95%</span>
              </div>
            </div>

            {/* Signal watch */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase font-mono text-muted-foreground tracking-widest">Signal Watch</div>
                <div className="text-[9px] font-mono text-muted-foreground/60 mt-0.5">Fire on High-strength signals</div>
              </div>
              <button
                onClick={() => setEditSignalWatch(!editSignalWatch)}
                className={cn(
                  "relative w-10 h-5 rounded-full transition-colors border",
                  editSignalWatch ? "bg-primary/30 border-primary/50" : "bg-secondary/50 border-border"
                )}
              >
                <span className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full transition-transform",
                  editSignalWatch ? "translate-x-5 bg-primary" : "translate-x-0.5 bg-muted-foreground"
                )} />
              </button>
            </div>

            {/* Max per day */}
            <div>
              <label className="text-[10px] uppercase font-mono text-muted-foreground tracking-widest mb-1.5 block">
                Max Dispatches / Day ({editMaxPerDay})
              </label>
              <div className="flex gap-1">
                {[1, 2, 3, 5, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => setEditMaxPerDay(n)}
                    className={cn(
                      "flex-1 text-[10px] font-mono py-1 rounded border transition-colors",
                      editMaxPerDay === n ? "bg-primary/20 border-primary/50 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >{n}</button>
                ))}
              </div>
            </div>

            {/* Save agent config */}
            <Button
              onClick={handleSaveAgentConfig}
              disabled={updateConfig.isPending}
              variant="outline"
              size="sm"
              className="w-full font-mono text-[10px] uppercase tracking-widest border-primary/20 text-primary hover:bg-primary hover:text-primary-foreground"
            >
              {updateConfig.isPending ? "Saving..." : "Apply Agent Config"}
            </Button>

            <div className="border-t border-border/50 pt-4 space-y-4">
              <div className="text-[10px] uppercase font-mono text-muted-foreground tracking-widest">Delivery</div>

              {/* Email */}
              <div className="bg-secondary/50 border border-border rounded-md px-3 py-2 flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <input
                  type="email" value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="bg-transparent border-none outline-none text-xs font-mono text-foreground w-full"
                  placeholder="Delivery email"
                />
              </div>

              {/* Picks per entry */}
              <div>
                <div className="text-[10px] font-mono text-muted-foreground mb-1">
                  Picks / Entry ({editPicks}) — {editEntryType === "PowerPlay" ? `${PP_MULTIPLIERS[editPicks] ?? 5}x` : `${FP_MULTIPLIERS[editPicks] ?? 2.25}x`}
                </div>
                <div className="flex gap-1">
                  {[2, 3, 4, 5, 6].map((n) => (
                    <button key={n} onClick={() => setEditPicks(n)}
                      className={cn("flex-1 text-[10px] font-mono py-1 rounded border transition-colors",
                        editPicks === n ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
                      )}>{n}</button>
                  ))}
                </div>
              </div>

              <Button onClick={handleSaveSettings} disabled={updateSettings.isPending} variant="outline" size="sm"
                className="w-full font-mono text-[10px] uppercase tracking-widest border-border text-muted-foreground hover:text-foreground">
                {updateSettings.isPending ? "Saving..." : "Save Delivery Settings"}
              </Button>
            </div>
          </div>
        </div>

        {/* ── CENTER: Tickets ──────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* ── Selector bar ─────────────────────────────────────────────────── */}
          <div className="flex-shrink-0 border-b border-border bg-card/20 px-5 py-3 flex items-center gap-4 flex-wrap">
            {/* Entry type */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mr-1">Entry</span>
              {(["PowerPlay", "FlexPlay"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => handleSelectEntryType(t)}
                  disabled={updateSettings.isPending}
                  className={cn(
                    "px-3 py-1.5 text-[11px] font-mono rounded-md border transition-all font-semibold",
                    editEntryType === t
                      ? t === "FlexPlay"
                        ? "bg-sky-500/20 border-sky-400/60 text-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.15)]"
                        : "bg-violet-500/20 border-violet-400/60 text-violet-300 shadow-[0_0_8px_rgba(167,139,250,0.15)]"
                      : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                  )}
                >
                  {t === "PowerPlay" ? "⚡ Power Play" : "🔄 Flex Play"}
                </button>
              ))}
            </div>

            <div className="w-px h-5 bg-border/60 flex-shrink-0" />

            {/* Risk profile */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mr-1">Risk</span>
              {([
                { value: "Safe", label: "🟢 Safe", active: "bg-emerald-500/15 border-emerald-400/50 text-emerald-300" },
                { value: "Balanced", label: "🔵 Balanced", active: "bg-blue-500/15 border-blue-400/50 text-blue-300" },
                { value: "Aggressive", label: "🔴 Aggressive", active: "bg-rose-500/15 border-rose-400/50 text-rose-300" },
                { value: "Mixed", label: "⚡ Mixed", active: "bg-amber-500/15 border-amber-400/50 text-amber-300" },
              ] as const).map(({ value, label, active }) => (
                <button
                  key={value}
                  onClick={() => handleSelectRisk(value)}
                  disabled={updateSettings.isPending}
                  className={cn(
                    "px-3 py-1.5 text-[11px] font-mono rounded-md border transition-all font-semibold",
                    editRisk === value
                      ? `${active} shadow-sm`
                      : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Saving indicator */}
            {updateSettings.isPending && (
              <span className="text-[9px] font-mono text-primary animate-pulse">saving…</span>
            )}

            {/* View toggle — pushed to right */}
            <div className="ml-auto flex items-center gap-0.5 bg-secondary/40 rounded-lg p-0.5 border border-border/50">
              <button
                onClick={() => setCenterView("entries")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono rounded-md transition-all font-semibold",
                  centerView === "entries"
                    ? "bg-card text-foreground shadow-sm border border-border/60"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <SplitSquareHorizontal className="w-3 h-3" />Entries
              </button>
              <button
                onClick={() => { setCenterView("results"); refetchResults(); }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono rounded-md transition-all font-semibold",
                  centerView === "results"
                    ? "bg-card text-foreground shadow-sm border border-border/60"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Radio className="w-3 h-3" />Live Results
                {pickResults && (() => {
                  const liveCount = pickResults.filter(p => p.gameStatus === "Live" || p.gameStatus === "Halftime").length;
                  return liveCount > 0
                    ? <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                    : null;
                })()}
              </button>
            </div>
          </div>

          {/* ── Entries view ─────────────────────────────────────────────────── */}
          {centerView === "entries" && (
          <div className="flex-1 overflow-y-auto p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <SplitSquareHorizontal className="w-3.5 h-3.5 text-primary" />
              Today's Entries
              {evaluateMutation.isPending && (
                <span className="text-[9px] text-primary animate-pulse">· AI evaluating...</span>
              )}
            </h2>
            <div className="flex items-center gap-2">
              {evaluations.size > 0 && (
                <span className="text-[9px] font-mono text-muted-foreground">
                  {Array.from(evaluations.values()).filter(e => e.agentWouldSelect).length} agent picks
                </span>
              )}
              {evalFailed && (
                <button
                  onClick={runEvaluation}
                  disabled={evaluateMutation.isPending}
                  className="flex items-center gap-1 text-[9px] font-mono text-yellow-400/70 hover:text-yellow-400 border border-yellow-400/20 rounded px-1.5 py-0.5 transition-colors"
                >
                  <RefreshCw className="w-2.5 h-2.5" />Retry eval
                </button>
              )}
              <button
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
                  setEvaluations(new Map());
                  setEvalFailed(false);
                }}
                className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/60 hover:text-muted-foreground border border-border/40 rounded px-1.5 py-0.5 transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />Reload
              </button>
            </div>
          </div>

          {loadingTickets ? (
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => <Card key={i} className="h-48 animate-pulse bg-secondary/30" />)}
            </div>
          ) : !tickets?.length ? (
            <div className="p-12 border border-dashed border-border rounded-lg text-center text-muted-foreground font-mono flex flex-col items-center">
              <Bot className="w-10 h-10 mb-3 opacity-40 text-primary" />
              <p className="text-sm">No entries constructed yet.</p>
              <p className="text-xs mt-1 opacity-50">Ghostspere is analyzing the slate...</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {tickets.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  isSelected={selectedTickets.has(ticket.id)}
                  onSelect={() => handleToggleTicket(ticket.id)}
                  evaluation={evaluations.get(ticket.id)}
                  evalFailed={evalFailed}
                  resultByPickId={resultByPickId}
                />
              ))}
            </div>
          )}
          </div>
          )}{/* end entries view */}

          {/* ── Live Results view ─────────────────────────────────────────────── */}
          {centerView === "results" && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                <Radio className="w-3.5 h-3.5 text-primary" />
                Live Results
                {loadingResults && <span className="text-[9px] text-primary animate-pulse">· loading...</span>}
              </h2>
              <button
                onClick={() => refetchResults()}
                className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/60 hover:text-muted-foreground border border-border/40 rounded px-1.5 py-0.5 transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />Refresh
              </button>
            </div>

            {!pickResults?.length ? (
              <div className="p-12 border border-dashed border-border rounded-lg text-center text-muted-foreground font-mono flex flex-col items-center">
                <Trophy className="w-10 h-10 mb-3 opacity-40 text-primary" />
                <p className="text-sm">No pick results yet.</p>
                <p className="text-xs mt-1 opacity-50">Results appear once your tickets have picks with scheduled games.</p>
              </div>
            ) : (() => {
              const live = pickResults.filter(p => p.gameStatus === "Live" || p.gameStatus === "Halftime");
              const upcoming = pickResults.filter(p => p.gameStatus === "Upcoming" || p.gameStatus === "Unknown");
              const finals = pickResults.filter(p => p.gameStatus === "Final");
              const won  = (pickResults as PickWithResult[]).filter(p => p.result === "hit").length;
              const lost = (pickResults as PickWithResult[]).filter(p => p.result === "miss").length;
              const push = (pickResults as PickWithResult[]).filter(p => p.result === "push").length;
              const autoSettled = (pickResults as PickWithResult[]).filter(p => p.settledSource === "espn").length;
              return (
                <div className="space-y-5">
                  {/* Stats bar */}
                  <div className="grid grid-cols-5 gap-2">
                    <div className="bg-secondary/30 border border-border/40 rounded-lg p-2.5 text-center">
                      <div className="text-xl font-mono font-bold text-foreground">{pickResults.length}</div>
                      <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wide mt-0.5">Picks</div>
                    </div>
                    <div className="bg-secondary/30 border border-border/40 rounded-lg p-2.5 text-center">
                      <div className="text-xl font-mono font-bold text-rose-400">{live.length}</div>
                      <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wide mt-0.5">Live</div>
                    </div>
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2.5 text-center">
                      <div className="text-xl font-mono font-bold text-emerald-400">{won}</div>
                      <div className="text-[9px] font-mono text-emerald-400/60 uppercase tracking-wide mt-0.5">Won ✓</div>
                    </div>
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-center">
                      <div className="text-xl font-mono font-bold text-red-400">{lost}</div>
                      <div className="text-[9px] font-mono text-red-400/60 uppercase tracking-wide mt-0.5">Lost ✗</div>
                    </div>
                    <div className="bg-secondary/30 border border-border/40 rounded-lg p-2.5 text-center">
                      <div className="text-xl font-mono font-bold text-amber-400">{push}</div>
                      <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-wide mt-0.5">Push</div>
                    </div>
                  </div>
                  {autoSettled > 0 && (
                    <div className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground/50">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400/50" />
                      {autoSettled} result{autoSettled !== 1 ? "s" : ""} auto-settled from ESPN live data
                    </div>
                  )}

                  {/* Live section */}
                  {live.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                        <span className="text-[10px] font-mono text-rose-400 uppercase tracking-widest font-bold">Live Now</span>
                        <span className="text-[9px] font-mono text-muted-foreground">({live.length})</span>
                      </div>
                      <div className="space-y-2">
                        {live.map(p => <PickResultRow key={p.pickId} pick={p as PickWithResult} onSettle={handleSettle} />)}
                      </div>
                    </div>
                  )}

                  {/* Upcoming section */}
                  {upcoming.length > 0 && (
                    <div>
                      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest font-bold mb-2 flex items-center gap-2">
                        <CalendarClock className="w-3 h-3" />Upcoming
                        <span className="font-normal text-muted-foreground/60">({upcoming.length})</span>
                      </div>
                      <div className="space-y-2">
                        {upcoming.map(p => <PickResultRow key={p.pickId} pick={p as PickWithResult} onSettle={handleSettle} />)}
                      </div>
                    </div>
                  )}

                  {/* Final section */}
                  {finals.length > 0 && (
                    <div>
                      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest font-bold mb-2 flex items-center gap-2">
                        <Trophy className="w-3 h-3" />Final
                        <span className="font-normal text-muted-foreground/60">({finals.length})</span>
                      </div>
                      <div className="space-y-2">
                        {finals.map(p => <PickResultRow key={p.pickId} pick={p as PickWithResult} onSettle={handleSettle} />)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          )}{/* end results view */}

        </div>{/* end center flex-col */}

        {/* ── RIGHT: Mission Log + Chat ────────────────────────────────────── */}
        <div className="w-80 flex-shrink-0 border-l border-border flex flex-col">

          {/* Mission Log */}
          <div className="flex-1 flex flex-col overflow-hidden border-b border-border">
            <div className="px-4 py-3 border-b border-border/50 flex-shrink-0 flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] uppercase font-mono text-foreground tracking-widest font-bold">Mission Log</span>
              {isArmed && <span className="ml-auto w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2">
              {!agentLog?.length ? (
                <div className="py-8 text-center text-muted-foreground font-mono text-[10px]">
                  <Shield className="w-6 h-6 mx-auto mb-2 opacity-30" />
                  No activity yet. Arm the agent to begin.
                </div>
              ) : (
                agentLog.map((entry: any) => <LogEntry key={entry.id} entry={entry} />)
              )}
            </div>
          </div>

          {/* Agent Chat */}
          <div className="flex flex-col" style={{ height: "260px" }}>
            <div className="px-4 py-2.5 border-b border-border/50 flex-shrink-0 flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] uppercase font-mono text-foreground tracking-widest font-bold">Command Interface</span>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 bg-background/20">
              {chatMessages.length === 0 && (
                <div className="text-[9px] text-muted-foreground/50 font-mono text-center py-4 leading-relaxed">
                  Try: "dispatch my top 2 picks now"<br />
                  or "arm the agent" or "raise threshold to 85%"
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={cn("text-[10px] font-mono rounded px-2 py-1.5 max-w-[90%]", msg.role === "user"
                  ? "bg-primary/20 text-primary ml-auto text-right"
                  : "bg-secondary/50 text-foreground"
                )}>
                  {msg.role === "agent" && <span className="text-primary/60 mr-1">›</span>}
                  {msg.content}
                  {chatStreaming && i === chatMessages.length - 1 && msg.role === "agent" && (
                    <span className="inline-block w-1 h-3 bg-primary ml-0.5 animate-pulse" />
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="px-3 py-2.5 border-t border-border/50 flex-shrink-0 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChat(); } }}
                placeholder="Command the agent..."
                disabled={chatStreaming}
                className="flex-1 bg-secondary/30 border border-border rounded px-2.5 py-1.5 text-[10px] font-mono text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/40 disabled:opacity-50"
              />
              <button
                onClick={handleChat}
                disabled={!chatInput.trim() || chatStreaming}
                className="flex-shrink-0 w-7 h-7 rounded flex items-center justify-center bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
