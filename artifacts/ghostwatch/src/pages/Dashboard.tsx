import { useListPicks, useGetPicksSummary, useGetTopPicks } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Activity, Target, AlertTriangle, CheckCircle2, TrendingUp, Trophy, ArrowRight, Crosshair } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

function RiskTierBadge({ tier }: { tier: string }) {
  const t = tier.toLowerCase();
  if (t === 'safe') return <Badge variant="safe" className="font-mono">SAFE</Badge>;
  if (t === 'balanced') return <Badge variant="balanced" className="font-mono">BALANCED</Badge>;
  return <Badge variant="aggressive" className="font-mono">AGGRESSIVE</Badge>;
}

function ConfidenceScore({ score }: { score: number }) {
  let colorClass = "text-primary";
  let bgClass = "bg-primary";
  if (score >= 85) { colorClass = "text-safe"; bgClass = "bg-safe"; }
  else if (score >= 70) { colorClass = "text-balanced"; bgClass = "bg-balanced"; }
  else { colorClass = "text-muted-foreground"; bgClass = "bg-muted-foreground"; }

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 w-24">
        <Progress value={score} indicatorClassName={bgClass} className="h-1.5 bg-secondary" />
      </div>
      <span className={cn("font-mono font-bold text-sm", colorClass)}>{score}%</span>
    </div>
  );
}

function PickCard({ pick }: { pick: any }) {
  return (
    <Card className="bg-card/50 border-border/50 hover:border-primary/30 transition-colors group">
      <CardContent className="p-5">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">{pick.sport}</Badge>
              <RiskTierBadge tier={pick.riskTier} />
            </div>
            <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              {pick.playerName}
            </h3>
            <p className="text-sm text-muted-foreground font-mono mt-1">
              {pick.team} vs {pick.opponent}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold font-mono tracking-tighter text-primary group-hover:text-primary/80 transition-colors">
              {pick.direction === 'Over' ? 'O' : 'U'} {pick.line}
            </div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">{pick.propType}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4 p-3 bg-secondary/30 rounded-md border border-border/30">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">AI Projection</div>
            <div className="font-mono text-lg">{pick.projection}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">Signal Confidence</div>
            <ConfidenceScore score={pick.confidence} />
          </div>
        </div>

        <div className="flex gap-2">
          <div className="w-1 bg-primary/20 rounded-full"></div>
          <p className="text-sm text-muted-foreground leading-relaxed flex-1">
            {pick.explanation}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [filterSport, setFilterSport] = useState<string>("ALL");
  const [filterTier, setFilterTier] = useState<string>("ALL");

  const { data: summary, isLoading: loadingSummary } = useGetPicksSummary();
  const { data: picks, isLoading: loadingPicks } = useListPicks(
    { 
      sport: filterSport !== "ALL" ? filterSport : undefined,
      riskTier: filterTier !== "ALL" ? filterTier as any : undefined
    }
  );
  const { data: topPicks } = useGetTopPicks();

  return (
    <div className="flex-1 flex flex-col">
      {/* Header/Summary Banner */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <Target className="w-6 h-6 text-primary" />
                Terminal Dashboard
              </h1>
              <p className="text-sm text-muted-foreground font-mono mt-1">Real-time AI projections & market mismatches</p>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="bg-secondary/50 font-mono text-xs px-3 py-1">
                LAST UPDATED: <span className="text-primary ml-2">{new Date().toLocaleTimeString()}</span>
              </Badge>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-4 gap-4">
            <Card className="bg-secondary/30 border-border/50">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="bg-primary/10 p-3 rounded-md text-primary">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-2xl font-mono font-bold text-foreground">
                    {loadingSummary ? '--' : summary?.totalPicks}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Active Signals</div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-secondary/30 border-border/50">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="bg-safe/10 p-3 rounded-md text-safe">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-2xl font-mono font-bold text-foreground">
                    {loadingSummary ? '--' : summary?.byRiskTier.Safe || 0}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Safe Tier</div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-secondary/30 border-border/50">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="bg-balanced/10 p-3 rounded-md text-balanced">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-2xl font-mono font-bold text-foreground">
                    {loadingSummary ? '--' : summary?.byRiskTier.Balanced || 0}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Balanced Tier</div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-secondary/30 border-border/50">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="bg-aggressive/10 p-3 rounded-md text-aggressive">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-2xl font-mono font-bold text-foreground">
                    {loadingSummary ? '--' : summary?.byRiskTier.Aggressive || 0}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Aggressive Tier</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </header>

      <div className="p-6 flex-1 flex flex-col gap-6">
        
        {/* Top Picks Horizontal List */}
        {topPicks && topPicks.length > 0 && (
          <section>
            <h2 className="text-sm font-mono text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" />
              Highest Confidence Signals
            </h2>
            <div className="grid grid-cols-3 gap-4">
              {topPicks.slice(0, 3).map(pick => (
                <div key={pick.id} className="bg-card border border-primary/20 rounded-lg p-4 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-primary/10 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-150"></div>
                  <div className="flex justify-between items-start mb-2 relative z-10">
                    <span className="text-xs font-mono text-primary uppercase">{pick.sport} • {pick.propType}</span>
                    <span className="font-mono text-sm font-bold text-foreground">{pick.confidence}%</span>
                  </div>
                  <div className="relative z-10">
                    <h4 className="font-bold text-lg mb-1">{pick.playerName}</h4>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="font-mono font-bold text-foreground">{pick.direction === 'Over' ? 'O' : 'U'} {pick.line}</span>
                      <ArrowRight className="w-3 h-3" />
                      <span className="font-mono text-primary">{pick.projection}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Main Feed */}
        <section className="flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-primary" />
              Live Feed
            </h2>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 bg-secondary rounded-md p-1 border border-border">
                {['ALL', 'Safe', 'Balanced', 'Aggressive'].map(tier => (
                  <button
                    key={tier}
                    onClick={() => setFilterTier(tier)}
                    className={cn(
                      "px-3 py-1 text-xs font-mono uppercase rounded transition-colors",
                      filterTier === tier ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tier}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 bg-secondary rounded-md p-1 border border-border">
                {['ALL', 'NBA', 'NFL', 'NHL'].map(sport => (
                  <button
                    key={sport}
                    onClick={() => setFilterSport(sport)}
                    className={cn(
                      "px-3 py-1 text-xs font-mono uppercase rounded transition-colors",
                      filterSport === sport ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {sport}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loadingPicks ? (
            <div className="grid grid-cols-2 gap-4">
              {[1,2,3,4].map(i => (
                <Card key={i} className="animate-pulse bg-secondary/20 border-transparent h-64" />
              ))}
            </div>
          ) : picks?.length === 0 ? (
            <div className="flex-1 flex items-center justify-center border border-dashed border-border rounded-lg bg-card/30">
              <div className="text-center text-muted-foreground">
                <Activity className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="font-mono text-sm uppercase tracking-widest">No signals match criteria</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {picks?.map(pick => (
                <PickCard key={pick.id} pick={pick} />
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
