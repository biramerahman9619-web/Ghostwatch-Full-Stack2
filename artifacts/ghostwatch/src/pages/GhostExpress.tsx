import {
  useListLiveGames,
  useListLivePicks,
  useListSignals,
  useGetLiveBetAnalysis,
  getListLivePicksQueryKey,
  getListLiveGamesQueryKey,
  getGetLiveBetAnalysisQueryKey,
  useGetGhostwatchStatus,
  getGetGhostwatchStatusQueryKey,
  useTriggerRefresh,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, Clock, Zap, Gauge, AlertCircle, RefreshCw,
  TrendingUp, TrendingDown, Minus, Target, Flame,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

function SignalBadge({ type, strength }: { type: string; strength: string }) {
  let color = "bg-primary text-primary-foreground";
  if (type === "InjuryUpdate" || type === "FoulTrouble") color = "bg-destructive text-destructive-foreground";
  if (type === "MismatchDetected") color = "bg-balanced text-balanced-foreground";
  return (
    <div className="flex items-center gap-2 text-xs">
      <Badge className={cn("rounded-sm font-mono tracking-wider border-transparent shadow-none", color)}>
        {type}
      </Badge>
      {strength === "High" && <Zap className="w-3 h-3 text-destructive" />}
    </div>
  );
}

function GameSignalsPanel({ gameId }: { gameId: string }) {
  const { data: signals, isLoading } = useListSignals({ gameId });
  if (isLoading) return <div className="h-20 animate-pulse bg-secondary/30 rounded-md" />;
  if (!signals?.length) return <div className="text-xs text-muted-foreground font-mono">No active anomalies detected.</div>;
  return (
    <div className="space-y-3">
      {signals.map((sig) => (
        <div key={sig.id} className="flex gap-3 items-start border-l-2 border-primary/50 pl-3 py-1">
          <div className="mt-0.5"><SignalBadge type={sig.type} strength={sig.strength} /></div>
          <div>
            <p className="text-sm font-medium">{sig.playerName} <span className="text-muted-foreground font-normal">({sig.team})</span></p>
            <p className="text-xs text-muted-foreground mt-0.5">{sig.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function LivePickRow({ pick }: { pick: any }) {
  return (
    <div className="flex items-center justify-between p-3 border-b border-border/50 hover:bg-secondary/30 transition-colors group">
      <div className="flex items-center gap-4">
        <div className="w-12 text-center">
          <div className="text-xl font-mono font-bold text-primary group-hover:scale-110 transition-transform">
            {pick.direction === "Over" ? "O" : "U"}
          </div>
          <div className="text-xs font-mono text-muted-foreground">{pick.line}</div>
        </div>
        <div>
          <h4 className="font-bold text-sm tracking-tight flex items-center gap-2">
            {pick.playerName}
            <Badge variant="outline" className="text-[9px] h-4 px-1.5 uppercase font-mono">{pick.propType}</Badge>
          </h4>
          <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate max-w-xs">{pick.explanation}</p>
        </div>
      </div>
      <div className="text-right flex items-center gap-4">
        <div className="text-right">
          <div className="text-xs text-muted-foreground uppercase font-mono tracking-widest">Conf</div>
          <div className="font-mono font-bold text-primary">{pick.confidence}%</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground uppercase font-mono tracking-widest">Proj</div>
          <div className="font-mono font-bold text-foreground">{pick.projection}</div>
        </div>
      </div>
    </div>
  );
}

function LiveBetPanel({ gameId }: { gameId: string }) {
  const [triggered, setTriggered] = useState(false);
  const params = { gameId };
  const { data, isLoading, isError, refetch } = useGetLiveBetAnalysis(params, {
    query: {
      enabled: triggered,
      staleTime: 3 * 60 * 1000, // 3 min — re-run after game state changes
      queryKey: getGetLiveBetAnalysisQueryKey(params),
    },
  });

  const handleAnalyze = () => {
    if (triggered) {
      void refetch();
    } else {
      setTriggered(true);
    }
  };

  const verdictStyle = {
    BET:  { bg: "bg-emerald-500/15", border: "border-emerald-400/50", text: "text-emerald-300", label: "🎯 BET NOW" },
    SKIP: { bg: "bg-red-500/15",     border: "border-red-400/50",     text: "text-red-300",     label: "✗ SKIP" },
    WAIT: { bg: "bg-amber-500/15",   border: "border-amber-400/50",   text: "text-amber-300",   label: "⏳ WAIT" },
  } as const;

  return (
    <div className="border-t border-border/50 bg-secondary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-primary" />
          Live Bet Analysis
        </h4>
        <Button
          size="sm"
          variant="outline"
          onClick={handleAnalyze}
          disabled={isLoading}
          className="h-6 text-[10px] font-mono px-2.5 gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
        >
          {isLoading ? (
            <><RefreshCw className="w-2.5 h-2.5 animate-spin" />Analyzing…</>
          ) : triggered && data ? (
            <><RefreshCw className="w-2.5 h-2.5" />Re-analyze</>
          ) : (
            <><Flame className="w-2.5 h-2.5" />Analyze Now</>
          )}
        </Button>
      </div>

      {!triggered && (
        <p className="text-[10px] font-mono text-muted-foreground/50">
          Ask the AI if this game is still worth betting based on live conditions.
        </p>
      )}

      {isLoading && (
        <div className="space-y-2">
          {[1, 2].map((i) => <div key={i} className="h-8 bg-secondary/30 rounded animate-pulse" />)}
        </div>
      )}

      {isError && triggered && (
        <p className="text-[10px] font-mono text-red-400/70">Analysis failed — game may not be live.</p>
      )}

      {data && !isLoading && (() => {
        const style = verdictStyle[data.verdict as keyof typeof verdictStyle] ?? verdictStyle.WAIT;
        return (
          <div className="space-y-3">
            {/* Verdict banner */}
            <div className={cn("rounded-md border px-3 py-2 flex items-center justify-between", style.bg, style.border)}>
              <span className={cn("font-mono font-bold text-sm tracking-widest", style.text)}>
                {style.label}
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">
                {new Date(data.analyzedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>

            {/* Reason */}
            <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">{data.reason}</p>

            {/* Momentum */}
            {data.momentum && (
              <div className="flex items-start gap-1.5">
                <TrendingUp className="w-3 h-3 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-[10px] font-mono text-foreground/70 italic">{data.momentum}</p>
              </div>
            )}

            {/* Live picks */}
            {data.picks.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">
                  Top Live Picks
                </div>
                {data.picks.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-2 rounded bg-secondary/20 border border-border/40"
                  >
                    <div className="w-8 text-center flex-shrink-0">
                      <div className="text-sm font-mono font-bold text-primary">{p.direction === "Over" ? "O" : "U"}</div>
                      <div className="text-[9px] font-mono text-muted-foreground">{p.line}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold truncate">{p.playerName}</span>
                        <Badge variant="outline" className="text-[8px] h-3.5 px-1 font-mono flex-shrink-0">{p.propType}</Badge>
                        <span className="ml-auto font-mono text-xs font-bold text-primary flex-shrink-0">{p.confidence}%</span>
                      </div>
                      <p className="text-[9px] font-mono text-muted-foreground/70 mt-0.5 leading-relaxed">{p.liveBetReason}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {data.verdict === "BET" && data.picks.length === 0 && (
              <p className="text-[9px] font-mono text-muted-foreground/50 italic">No specific picks met the live confidence threshold.</p>
            )}
          </div>
        );
      })()}
    </div>
  );
}

export default function GhostExpress() {
  const { data: games, isLoading: loadingGames } = useListLiveGames({
    query: { refetchInterval: 30_000, queryKey: getListLiveGamesQueryKey() },
  });
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const activeGameId = selectedGameId || (games?.[0]?.id ?? null);
  const livePicksParams = { gameId: activeGameId || undefined };
  const { data: livePicks, isLoading: loadingPicks } = useListLivePicks(livePicksParams, {
    query: { enabled: !!activeGameId, queryKey: getListLivePicksQueryKey(livePicksParams) },
  });

  const statusQueryKey = getGetGhostwatchStatusQueryKey();
  const { data: refreshStatus } = useGetGhostwatchStatus({
    query: { refetchInterval: 60_000, queryKey: statusQueryKey },
  });

  const { mutate: doRefresh, isPending: isRefreshing } = useTriggerRefresh({
    mutation: {
      onSuccess: () => {
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: statusQueryKey });
          void queryClient.invalidateQueries({ queryKey: getListLiveGamesQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getListLivePicksQueryKey() });
        }, 3000);
      },
    },
  });

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <header className="border-b border-border bg-card p-6 flex-shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary" />
              Ghost Express
            </h1>
            <p className="text-sm text-muted-foreground font-mono mt-1">Live In-Game Signals · Scoreboard · Live Bet Analysis</p>
          </div>
          <div className="flex items-center gap-2">
            {refreshStatus?.usingRealData ? (
              <Badge variant="safe" className="font-mono text-xs px-3 py-1">LIVE DATA</Badge>
            ) : (
              <Badge variant="outline" className="bg-secondary/50 font-mono text-xs px-3 py-1 text-muted-foreground">DEMO DATA</Badge>
            )}
            {refreshStatus?.lastRefreshedAt ? (
              <Badge variant="outline" className="bg-secondary/50 font-mono text-xs px-3 py-1">
                UPDATED: <span className="text-primary ml-2">{new Date(refreshStatus.lastRefreshedAt).toLocaleTimeString()}</span>
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-secondary/50 font-mono text-xs px-3 py-1 text-muted-foreground">
                NEVER REFRESHED
              </Badge>
            )}
            <Button
              size="sm"
              variant="outline"
              className="font-mono text-xs h-7 gap-1.5 border-border/60 hover:border-primary/50 hover:text-primary"
              disabled={isRefreshing || !refreshStatus?.usingRealData}
              onClick={() => doRefresh()}
              title={!refreshStatus?.usingRealData ? "Refresh unavailable in demo mode" : "Fetch latest picks from The Odds API"}
            >
              <RefreshCw className={cn("w-3 h-3", isRefreshing && "animate-spin")} />
              {isRefreshing ? "REFRESHING…" : "REFRESH NOW"}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Live Scoreboard */}
        <div className="w-1/3 border-r border-border bg-card/30 flex flex-col">
          <div className="p-4 border-b border-border/50 flex-shrink-0 flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Live Scoreboard</span>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono text-muted-foreground/50">auto-refresh 30s</span>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loadingGames ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-secondary/50 rounded-lg animate-pulse" />)}
              </div>
            ) : !games?.length ? (
              <div className="text-center p-8 text-muted-foreground font-mono text-sm border border-dashed border-border rounded-lg">
                No games currently live.
              </div>
            ) : (
              games.map((game) => {
                const isActive = game.id === activeGameId;
                return (
                  <button
                    key={game.id}
                    onClick={() => setSelectedGameId(game.id)}
                    className={cn(
                      "w-full text-left p-4 rounded-lg border transition-all relative overflow-hidden",
                      isActive
                        ? "bg-primary/5 border-primary shadow-[0_0_15px_rgba(0,255,255,0.1)]"
                        : "bg-card border-border hover:border-primary/50 hover:bg-secondary/20",
                    )}
                  >
                    {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
                    <div className="flex justify-between items-center mb-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-mono text-[10px] tracking-wider",
                          game.status === "Live" ? "text-destructive border-destructive/30" : "",
                        )}
                      >
                        {game.quarter} • {game.timeRemaining}
                      </Badge>
                      <div className="flex items-center gap-1 text-[10px] uppercase font-mono text-muted-foreground">
                        <Gauge className="w-3 h-3" />
                        Pace: <span className={cn(game.pace === "Fast" && "text-primary")}>{game.pace}</span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-foreground text-sm">{game.awayTeam}</span>
                        <span className="font-mono text-xl font-bold">{game.awayScore}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-foreground text-sm">{game.homeTeam}</span>
                        <span className="font-mono text-xl font-bold">{game.homeScore}</span>
                      </div>
                    </div>

                    {/* Score bar */}
                    {(() => {
                      const total = game.homeScore + game.awayScore;
                      const homeWidth = total > 0 ? Math.round((game.homeScore / total) * 100) : 50;
                      return total > 0 ? (
                        <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full bg-primary/60 transition-all duration-700" style={{ width: `${homeWidth}%` }} />
                        </div>
                      ) : null;
                    })()}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Game Intel + Live Picks + Live Bet Analysis */}
        <div className="flex-1 flex flex-col bg-background overflow-hidden">
          {activeGameId ? (
            <>
              {/* Anomaly Signals */}
              <div className="border-b border-border bg-card/20 p-6 flex-shrink-0">
                <h3 className="text-sm font-mono text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-primary" />
                  Active Game Anomalies
                </h3>
                <GameSignalsPanel gameId={activeGameId} />
              </div>

              {/* Live Prop Adjustments */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="p-4 border-b border-border/50 bg-secondary/10 flex-shrink-0 flex items-center justify-between">
                  <h3 className="text-sm font-mono text-foreground uppercase tracking-widest flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" />
                    Live Prop Adjustments
                  </h3>
                  <Badge variant="outline" className="font-mono text-xs bg-primary/10 text-primary border-primary/30">
                    Streaming
                  </Badge>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {loadingPicks ? (
                    <div className="p-4 space-y-4">
                      {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-secondary/30 rounded-md animate-pulse" />)}
                    </div>
                  ) : !livePicks?.length ? (
                    <div className="p-6 text-center text-muted-foreground font-mono text-sm border-b border-border/30">
                      Waiting for high-value mismatches...
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {livePicks.map((pick) => <LivePickRow key={pick.id} pick={pick} />)}
                    </div>
                  )}

                  {/* Live Bet Analysis panel — always visible when a game is selected */}
                  <LiveBetPanel gameId={activeGameId} />
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground font-mono text-sm">
              Select a live game to view intel.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
