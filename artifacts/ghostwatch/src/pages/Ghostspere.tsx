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
  getListTicketsQueryKey,
  getGetSettingsQueryKey,
  getGetAgentConfigQueryKey,
  getGetAgentStatusQueryKey,
  getListAgentLogQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bot, Mail, Settings2, SplitSquareHorizontal, Shield, ShieldCheck, ShieldOff,
  Zap, Clock, Send, Activity, MessageSquare, TrendingUp, RefreshCw,
} from "lucide-react";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

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
function TicketCard({ ticket, onSelect, isSelected, evaluation, evalFailed }: {
  ticket: any; onSelect: () => void; isSelected: boolean;
  evaluation?: { aiConfidence: number; reasoning: string; agentWouldSelect: boolean };
  evalFailed?: boolean;
}) {
  const isPP = (ticket.entryType ?? "PowerPlay") === "PowerPlay";
  const pickCount = ticket.picks?.length ?? 0;
  const multiplier = ticket.payoutMultiplier ?? entryMultiplier(ticket.entryType ?? "PowerPlay", pickCount);
  const flexNote = !isPP ? FP_BREAKDOWN[pickCount] : "";
  const winPct: number = ticket.winProbability ?? 0;
  const entryColor = isPP ? "border-purple-400/40 text-purple-300" : "border-sky-400/40 text-sky-300";

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all border-2",
        isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
        evaluation?.agentWouldSelect && "ring-1 ring-primary/30",
      )}
      onClick={onSelect}
    >
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
        <div className="space-y-2">
          {ticket.picks.map((pick: any, i: number) => (
            <div key={i} className="flex justify-between items-center text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold truncate">{pick.playerName}</span>
                <span className="text-muted-foreground shrink-0">{pick.propType}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-1">
                <span className="text-[10px] font-mono text-muted-foreground">{pick.confidence}%</span>
                <span className="font-mono font-medium text-primary">{pick.direction === "Over" ? "O" : "U"} {pick.line}</span>
              </div>
            </div>
          ))}
        </div>
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
      { data: { email: editEmail, riskProfile: editRisk as any, entryType: editEntryType as any, picksPerTicket: editPicks } },
      {
        onSuccess: () => {
          toast({ title: "Settings saved", className: "border-primary bg-card text-primary font-mono" });
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
        },
        onError: (err: any) => toast({ title: "Save failed", description: err?.response?.data?.error ?? err?.message, variant: "destructive" }),
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
              <div className="text-[10px] uppercase font-mono text-muted-foreground tracking-widest">Entry Settings</div>

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

              {/* Risk profile */}
              <div className="grid grid-cols-2 gap-1 bg-secondary/30 p-1 rounded-md border border-border">
                {(["Safe", "Balanced", "Aggressive", "Mixed"] as const).map((r) => (
                  <button key={r} onClick={() => setEditRisk(r)}
                    className={cn("py-1.5 text-[10px] font-mono rounded border transition-all uppercase tracking-wide",
                      editRisk === r ? "bg-primary/20 border-primary/50 text-primary font-bold" : "border-transparent text-muted-foreground hover:text-foreground"
                    )}>{r}</button>
                ))}
              </div>

              {/* Entry type */}
              <div className="grid grid-cols-2 gap-1 bg-secondary/30 p-1 rounded-md border border-border">
                {(["PowerPlay", "FlexPlay"] as const).map((t) => (
                  <button key={t} onClick={() => setEditEntryType(t)}
                    className={cn("py-1.5 text-[10px] font-mono rounded border transition-all",
                      editEntryType === t
                        ? t === "FlexPlay" ? "bg-sky-500/20 border-sky-400/50 text-sky-300 font-bold" : "bg-purple-500/20 border-purple-400/50 text-purple-300 font-bold"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}>{t === "PowerPlay" ? "⚡ Power Play" : "🔄 Flex Play"}</button>
                ))}
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
                {updateSettings.isPending ? "Saving..." : "Save Entry Settings"}
              </Button>
            </div>
          </div>
        </div>

        {/* ── CENTER: Tickets ──────────────────────────────────────────────── */}
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
                  title="Re-run AI evaluation"
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
                title="Reload picks"
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
                />
              ))}
            </div>
          )}
        </div>

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
