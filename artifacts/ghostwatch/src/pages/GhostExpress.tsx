import { useListLiveGames, useListLivePicks, useListSignals, getListLivePicksQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, Zap, Gauge, AlertCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

function SignalBadge({ type, strength }: { type: string, strength: string }) {
  let color = "bg-primary text-primary-foreground";
  if (type === 'PaceSpike') color = "bg-primary text-primary-foreground";
  if (type === 'InjuryUpdate' || type === 'FoulTrouble') color = "bg-destructive text-destructive-foreground";
  if (type === 'MismatchDetected') color = "bg-balanced text-balanced-foreground";

  return (
    <div className="flex items-center gap-2 text-xs">
      <Badge className={cn("rounded-sm font-mono tracking-wider border-transparent shadow-none", color)}>
        {type}
      </Badge>
      {strength === 'High' && <Zap className="w-3 h-3 text-destructive" />}
    </div>
  );
}

function GameSignalsPanel({ gameId }: { gameId: string }) {
  const { data: signals, isLoading } = useListSignals({ gameId });

  if (isLoading) return <div className="h-20 animate-pulse bg-secondary/30 rounded-md"></div>;
  if (!signals?.length) return <div className="text-xs text-muted-foreground font-mono">No active anomalies detected.</div>;

  return (
    <div className="space-y-3">
      {signals.map(sig => (
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
            {pick.direction === 'Over' ? 'O' : 'U'}
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

export default function GhostExpress() {
  const { data: games, isLoading: loadingGames } = useListLiveGames();
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  const activeGameId = selectedGameId || (games?.[0]?.id ?? null);
  const livePicksParams = { gameId: activeGameId || undefined };
  const { data: livePicks, isLoading: loadingPicks } = useListLivePicks(
    livePicksParams,
    { query: { enabled: !!activeGameId, queryKey: getListLivePicksQueryKey(livePicksParams) } }
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <header className="border-b border-border bg-card p-6 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            Ghost Express
          </h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">Live In-Game Signals & Adjustments</p>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Live Games List */}
        <div className="w-1/3 border-r border-border bg-card/30 flex flex-col">
          <div className="p-4 border-b border-border/50 flex-shrink-0 flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Live Slate</span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
            </span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loadingGames ? (
              <div className="space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-24 bg-secondary/50 rounded-lg animate-pulse" />)}
              </div>
            ) : games?.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground font-mono text-sm border border-dashed border-border rounded-lg">No games currently live.</div>
            ) : (
              games?.map(game => {
                const isActive = game.id === activeGameId;
                return (
                  <button
                    key={game.id}
                    onClick={() => setSelectedGameId(game.id)}
                    className={cn(
                      "w-full text-left p-4 rounded-lg border transition-all relative overflow-hidden",
                      isActive 
                        ? "bg-primary/5 border-primary shadow-[0_0_15px_rgba(0,255,255,0.1)]" 
                        : "bg-card border-border hover:border-primary/50 hover:bg-secondary/20"
                    )}
                  >
                    {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary"></div>}
                    <div className="flex justify-between items-center mb-3">
                      <Badge variant="outline" className={cn("font-mono text-[10px] tracking-wider", game.status === 'Live' ? 'text-destructive border-destructive/30' : '')}>
                        {game.quarter} • {game.timeRemaining}
                      </Badge>
                      <div className="flex items-center gap-1 text-[10px] uppercase font-mono text-muted-foreground">
                        <Gauge className="w-3 h-3" />
                        Pace: <span className={cn(game.pace === 'Fast' && 'text-primary')}>{game.pace}</span>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-foreground">{game.awayTeam}</span>
                        <span className="font-mono text-lg">{game.awayScore}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-foreground">{game.homeTeam}</span>
                        <span className="font-mono text-lg">{game.homeScore}</span>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right Column: Game Intel & Live Picks */}
        <div className="flex-1 flex flex-col bg-background overflow-hidden">
          {activeGameId ? (
            <>
              {/* Top Panel: Signals */}
              <div className="border-b border-border bg-card/20 p-6 flex-shrink-0">
                <h3 className="text-sm font-mono text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-primary" />
                  Active Game Anomalies
                </h3>
                <GameSignalsPanel gameId={activeGameId} />
              </div>

              {/* Bottom Panel: Live Picks Stream */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="p-4 border-b border-border/50 bg-secondary/10 flex-shrink-0 flex items-center justify-between">
                  <h3 className="text-sm font-mono text-foreground uppercase tracking-widest flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" />
                    Live Prop Adjustments
                  </h3>
                  <Badge variant="outline" className="font-mono text-xs bg-primary/10 text-primary border-primary/30">Streaming</Badge>
                </div>
                
                <div className="flex-1 overflow-y-auto p-2">
                  {loadingPicks ? (
                    <div className="p-4 space-y-4">
                      {[1,2,3].map(i => <div key={i} className="h-16 bg-secondary/30 rounded-md animate-pulse" />)}
                    </div>
                  ) : livePicks?.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm">
                      Waiting for high-value mismatches...
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {livePicks?.map(pick => (
                        <LivePickRow key={pick.id} pick={pick} />
                      ))}
                    </div>
                  )}
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
