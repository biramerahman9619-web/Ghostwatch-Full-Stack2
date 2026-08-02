import { useListTickets, useSendTicketEmail, useGetSettings, useUpdateSettings, getListTicketsQueryKey, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, Mail, Settings2, SplitSquareHorizontal, TrendingUp } from "lucide-react";
import React, { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";


/** PrizePicks Power Play payout multipliers by pick count */
const PP_MULTIPLIERS: Record<number, number> = { 2: 3, 3: 5, 4: 10, 5: 20, 6: 40 };
const FP_MULTIPLIERS: Record<number, number>  = { 2: 3, 3: 2.25, 4: 5, 5: 10, 6: 20 };
const FP_BREAKDOWN: Record<number, string> = {
  2: "",
  3: "1.25x if 1 miss",
  4: "1.5x if 1 miss",
  5: "2x if 1 miss · 0.5x if 2",
  6: "2x if 1 miss · 0.5x if 2",
};

function entryMultiplier(entryType: string, pickCount: number): number {
  if (entryType === 'FlexPlay') return FP_MULTIPLIERS[pickCount] ?? 2.25;
  return PP_MULTIPLIERS[pickCount] ?? 5;
}

/** Compact "2S · 3B · 1A" summary for Mixed entries. */
function MixedTierSummary({ picks }: { picks: any[] }) {
  const safe = picks.filter((p) => p.riskTier === 'Safe').length;
  const balanced = picks.filter((p) => p.riskTier === 'Balanced').length;
  const aggressive = picks.filter((p) => p.riskTier === 'Aggressive').length;

  const parts = [] as React.ReactElement[];
  if (safe > 0)       parts.push(<span key="s" className="text-safe">{safe}S</span>);
  if (balanced > 0)   parts.push(<span key="b" className="text-balanced">{balanced}B</span>);
  if (aggressive > 0) parts.push(<span key="a" className="text-aggressive">{aggressive}A</span>);

  return (
    <span className="text-[10px] font-mono flex items-center gap-1">
      {parts.reduce<React.ReactElement[]>((acc, el, i) => {
        if (i > 0) acc.push(<span key={`sep-${i}`} className="text-muted-foreground/50">·</span>);
        acc.push(el);
        return acc;
      }, [])}
    </span>
  );
}

/** Win-rate colour: green ≥55%, yellow ≥35%, red <35% */
function winRateColor(pct: number): string {
  if (pct >= 55) return "text-emerald-400";
  if (pct >= 35) return "text-yellow-400";
  return "text-red-400";
}

function TicketCard({ ticket, onSelect, isSelected }: { ticket: any, onSelect: () => void, isSelected: boolean }) {
  const isMixed     = ticket.riskTier === 'Mixed';
  const isPP        = (ticket.entryType ?? 'PowerPlay') === 'PowerPlay';
  const pickCount   = ticket.picks?.length ?? 0;
  const multiplier  = ticket.payoutMultiplier ?? entryMultiplier(ticket.entryType ?? 'PowerPlay', pickCount);
  const flexNote    = !isPP ? FP_BREAKDOWN[pickCount] : "";
  const winPct: number = ticket.winProbability ?? 0;

  const entryColor  = isPP
    ? "border-purple-400/40 text-purple-300"
    : "border-sky-400/40 text-sky-300";

  return (
    <Card 
      className={cn(
        "cursor-pointer transition-all border-2",
        isSelected ? `border-primary bg-primary/5` : "border-border hover:border-primary/50"
      )}
      onClick={onSelect}
    >
      <CardContent className="p-5">
        <div className="flex justify-between items-center mb-4 pb-4 border-b border-border/50">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={cn("font-mono uppercase bg-background text-[10px] px-2", entryColor)}>
                {isPP ? '⚡ POWER PLAY' : '🔄 FLEX PLAY'}
              </Badge>
              {isMixed && <MixedTierSummary picks={ticket.picks} />}
              <span className="text-xs text-muted-foreground font-mono">{ticket.sport}</span>
            </div>
            {flexNote && (
              <span className="text-[9px] font-mono text-muted-foreground/60 pl-0.5">{flexNote}</span>
            )}
          </div>
          {/* Payout + Win Rate */}
          <div className="text-right flex-shrink-0 ml-3 flex flex-col items-end gap-1">
            <div className="flex items-baseline gap-2">
              <div className="text-right">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">Payout</div>
                <div className={cn("font-mono font-bold text-2xl", isPP ? "text-purple-300" : "text-sky-300")}>
                  {multiplier}x
                </div>
              </div>
              <div className="text-right pl-3 border-l border-border/40">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">Win Rate</div>
                <div className={cn("font-mono font-bold text-2xl", winRateColor(winPct))}>
                  {winPct.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {ticket.picks.map((pick: any, i: number) => (
            <div key={i} className="flex justify-between items-center text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold truncate">{pick.playerName}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{pick.propType}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-[10px] font-mono text-muted-foreground">{pick.confidence}%</span>
                <span className="font-mono font-medium text-primary">
                  {pick.direction === 'Over' ? 'O' : 'U'} {pick.line}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 pt-3 border-t border-border/30 flex items-center gap-1.5">
          <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest">
            {pickCount} picks · {ticket.riskTier} confidence
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Ghostspere() {
  const { data: tickets, isLoading: loadingTickets } = useListTickets();
  const { data: settings } = useGetSettings();
  const sendEmail = useSendTicketEmail();
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set());
  const [editEmail, setEditEmail] = useState<string>("");
  const [editRisk, setEditRisk] = useState<"Safe" | "Balanced" | "Aggressive" | "Mixed">("Balanced");
  const [editEntryType, setEditEntryType] = useState<"PowerPlay" | "FlexPlay">("PowerPlay");
  const [editPicks, setEditPicks] = useState<number>(3);

  // Sync settings when loaded
  useEffect(() => {
    if (settings) {
      setEditEmail(settings.email || "");
      setEditRisk((settings.riskProfile as any) || "Balanced");
      setEditEntryType((settings.entryType as any) || "PowerPlay");
      setEditPicks(settings.picksPerTicket || 3);
    }
  }, [settings]);

  const handleToggleTicket = (id: string) => {
    const next = new Set(selectedTickets);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedTickets(next);
  };

  const handleSend = () => {
    if (selectedTickets.size === 0) return;
    if (!settings?.email) {
      toast({
        title: "No delivery address",
        description: "Set your email in the Construction Protocol panel first.",
        variant: "destructive",
      });
      return;
    }
    
    sendEmail.mutate({
      data: {
        email: settings.email,
        ticketIds: Array.from(selectedTickets)
      }
    }, {
      onSuccess: (data: any) => {
        const skipped: number = data?.skipped ?? 0;
        const dispatched: number = data?.dispatched ?? selectedTickets.size;
        if (skipped > 0) {
          toast({
            title: `${dispatched} entr${dispatched !== 1 ? 'ies' : 'y'} dispatched`,
            description: `${skipped} entr${skipped !== 1 ? 'ies' : 'y'} expired mid-session and were skipped — entry list refreshed.`,
            className: "border-yellow-500/50 bg-card text-yellow-400 font-mono",
          });
          // Picks rotated — refresh list immediately so current entries are shown
          queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
        } else {
          toast({
            title: "Entries dispatched",
            description: `Sent ${dispatched} entr${dispatched !== 1 ? 'ies' : 'y'} to ${settings.email}`,
            className: "border-primary bg-card text-primary font-mono",
          });
        }
        setSelectedTickets(new Set());
      },
      onError: (err: any) => {
        const msg: string = err?.response?.data?.error ?? err?.message ?? "Unknown error";
        const isSmtp = msg.includes("SMTP") || msg.includes("not configured");
        toast({
          title: isSmtp ? "Email not configured" : "Dispatch failed",
          description: isSmtp
            ? "Add SMTP_HOST, SMTP_USER, and SMTP_PASS as Replit secrets to enable email delivery."
            : msg,
          variant: "destructive",
        });
      }
    });
  };

  const handleSaveSettings = () => {
    updateSettings.mutate({
      data: {
        email: editEmail,
        riskProfile: editRisk as any,
        entryType: editEntryType as any,
        picksPerTicket: editPicks,
      }
    }, {
      onSuccess: () => {
        toast({
          title: "Protocol Updated",
          description: "Butler settings have been saved successfully.",
          className: "border-primary bg-card text-primary font-mono",
        });
        // Refresh both settings and tickets so the new config is immediately reflected
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
      },
      onError: (err: any) => {
        const msg: string = err?.response?.data?.error ?? err?.message ?? "Unknown error";
        toast({
          title: "Settings update failed",
          description: msg,
          variant: "destructive",
        });
      },
    });
  };

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-border bg-card p-6 flex-shrink-0 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Bot className="w-6 h-6 text-primary" />
            Ghostspere
          </h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">PrizePicks-Style Entry Construction & Dispatch</p>
        </div>
        <Button 
          onClick={handleSend} 
          disabled={selectedTickets.size === 0 || sendEmail.isPending}
          className="font-mono uppercase tracking-widest gap-2"
        >
          <Mail className="w-4 h-4" />
          {sendEmail.isPending ? 'Dispatching...' : `Dispatch Entries (${selectedTickets.size})`}
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 flex gap-6">
        
        {/* Main Content: Tickets */}
        <div className="flex-1">
          <h2 className="text-sm font-mono text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
            <SplitSquareHorizontal className="w-4 h-4 text-primary" />
            Today's Pick Entries
          </h2>

          {loadingTickets ? (
            <div className="grid grid-cols-2 gap-4">
              {[1,2,3,4].map(i => <Card key={i} className="h-48 animate-pulse bg-secondary/30" />)}
            </div>
          ) : tickets?.length === 0 ? (
            <div className="p-12 border border-dashed border-border rounded-lg text-center text-muted-foreground font-mono flex flex-col items-center">
              <Bot className="w-12 h-12 mb-4 opacity-50 text-primary" />
              <p>No entries constructed yet.</p>
              <p className="text-xs mt-2 opacity-50">Ghostspere is analyzing the slate...</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {tickets?.map(ticket => (
                <TicketCard 
                  key={ticket.id} 
                  ticket={ticket} 
                  isSelected={selectedTickets.has(ticket.id)}
                  onSelect={() => handleToggleTicket(ticket.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar: Settings */}
        <div className="w-80 flex-shrink-0">
          <Card className="bg-card/50 border-border/50 sticky top-6">
            <CardHeader className="pb-4 border-b border-border/50">
              <CardTitle className="text-sm font-mono text-foreground uppercase tracking-widest flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-primary" />
                Construction Protocol
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-6">
              
              <div>
                <label className="text-[10px] uppercase font-mono text-muted-foreground tracking-widest mb-2 block">Delivery Address</label>
                <div className="bg-secondary/50 border border-border rounded-md px-3 py-2 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <input 
                    type="email" 
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="bg-transparent border-none outline-none text-sm font-mono text-foreground w-full"
                    placeholder="Enter email address"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-mono text-muted-foreground tracking-widest mb-2 block">Entry Type</label>
                <div className="grid grid-cols-2 gap-1.5 bg-secondary/30 p-1.5 rounded-md border border-border">
                  {[
                    { value: 'PowerPlay', label: '⚡ Power Play', desc: 'All picks must hit' },
                    { value: 'FlexPlay',  label: '🔄 Flex Play',  desc: 'Partial credit available' },
                  ].map(({ value, label, desc }) => (
                    <button
                      key={value}
                      onClick={() => setEditEntryType(value as any)}
                      className={cn(
                        "flex flex-col items-center py-2 px-1 text-xs font-mono rounded transition-all border",
                        editEntryType === value
                          ? value === 'FlexPlay'
                            ? "bg-sky-500/20 border-sky-400/50 text-sky-300 font-bold shadow-sm"
                            : "bg-purple-500/20 border-purple-400/50 text-purple-300 font-bold shadow-sm"
                          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      )}
                    >
                      <span className="tracking-wide">{label}</span>
                      <span className={cn(
                        "text-[9px] mt-0.5 normal-case tracking-normal font-normal",
                        editEntryType === value ? "opacity-80" : "opacity-50"
                      )}>{desc}</span>
                    </button>
                  ))}
                </div>

              <div className="mt-3">
                <label className="text-[10px] uppercase font-mono text-muted-foreground tracking-widest mb-2 block">Pick Confidence</label>
                <div className="grid grid-cols-2 gap-1.5 bg-secondary/30 p-1.5 rounded-md border border-border">
                  {[
                    { value: 'Safe',       label: 'Safe',       desc: 'High confidence' },
                    { value: 'Balanced',   label: 'Balanced',   desc: 'Moderate edge' },
                    { value: 'Aggressive', label: 'Aggressive', desc: 'High ceiling' },
                    { value: 'Mixed',      label: '⚡ Mixed',   desc: 'All tiers blended' },
                  ].map(({ value, label, desc }) => (
                    <button
                      key={value}
                      onClick={() => setEditRisk(value as any)}
                      className={cn(
                        "flex flex-col items-center py-2 px-1 text-xs font-mono rounded transition-all border",
                        editRisk === value
                          ? "bg-primary/20 border-primary/50 text-primary font-bold shadow-sm"
                          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      )}
                    >
                      <span className="uppercase tracking-wide">{label}</span>
                      <span className={cn(
                        "text-[9px] mt-0.5 normal-case tracking-normal font-normal",
                        editRisk === value ? "opacity-80" : "opacity-50"
                      )}>{desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-mono text-muted-foreground tracking-widest mb-2 block">
                  Picks per Entry ({editPicks}) — {editEntryType === 'PowerPlay' ? `${PP_MULTIPLIERS[editPicks] ?? 5}x payout` : `${FP_MULTIPLIERS[editPicks] ?? 2.25}x payout`}
                </label>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground">2</span>
                  <input 
                    type="range" 
                    min="2" 
                    max="6" 
                    value={editPicks}
                    onChange={(e) => setEditPicks(Number(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <span className="text-xs font-mono text-muted-foreground">6</span>
                </div>
                <div className="flex justify-between mt-1">
                  {[2,3,4,5,6].map(n => (
                    <button
                      key={n}
                      onClick={() => setEditPicks(n)}
                      className={cn(
                        "text-[10px] font-mono px-2 py-0.5 rounded transition-colors",
                        editPicks === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {n}p·{editEntryType === 'PowerPlay' ? `${PP_MULTIPLIERS[n] ?? 5}x` : `${FP_MULTIPLIERS[n] ?? 2.25}x`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-border/50">
                <Button 
                  onClick={handleSaveSettings}
                  disabled={updateSettings.isPending}
                  variant="outline" 
                  className="w-full font-mono text-xs uppercase tracking-widest border-primary/20 text-primary hover:bg-primary hover:text-primary-foreground"
                >
                  {updateSettings.isPending ? 'Updating...' : 'Update Configuration'}
                </Button>
              </div>

            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
