import { useGetPortalPicksPreview } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useLocation } from "wouter";
import { Activity, useEffect } from "react";
import { Lock, ShieldAlert, CheckCircle2, AlertTriangle, Crosshair, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Picks() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { data: picksData, isLoading: isPicksLoading } = useGetPortalPicksPreview();

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthenticated, isAuthLoading, setLocation]);

  if (isAuthLoading || !isAuthenticated) {
    return (
      <div className="flex-1 flex items-center justify-center text-primary font-mono text-sm animate-pulse">
        VERIFYING AUTHORIZATION...
      </div>
    );
  }

  return (
    <div className="flex-1 w-full relative">
      {/* Dashboard header */}
      <div className="border-b border-white/10 bg-black/50 pt-12 pb-8 sticky top-16 z-30 backdrop-blur-md">
        <div className="container mx-auto px-4 md:px-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 text-primary font-mono text-xs uppercase tracking-widest mb-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                Live Data Feed
              </div>
              <h1 className="text-4xl font-bold font-sans uppercase tracking-widest text-white text-glow">
                Terminal View
              </h1>
              <p className="text-muted-foreground font-mono text-sm max-w-xl">
                Current systemic intercepts. Confidence scores driven by algorithmic mismatch detection.
              </p>
            </div>
            
            <div className="flex gap-6 text-sm font-mono border border-white/10 p-4 bg-black">
              <div className="space-y-1">
                <div className="text-muted-foreground uppercase text-[10px] tracking-widest">Available</div>
                <div className="text-white text-xl">{picksData?.totalAvailable || 0}</div>
              </div>
              <div className="w-[1px] bg-white/10" />
              <div className="space-y-1">
                <div className="text-muted-foreground uppercase text-[10px] tracking-widest">Encrypted</div>
                <div className="text-primary text-xl">{picksData?.lockedCount || 0}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-6 py-12">
        {isPicksLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-64 border border-white/5 bg-white/5 animate-pulse rounded-sm" />
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {picksData?.picks.map((pick) => (
                <div key={pick.id} className="border border-white/10 bg-card/50 hover:bg-card transition-colors relative group">
                  {/* Decorative top border */}
                  <div className="absolute top-0 left-0 w-full h-[1px] bg-primary/20 group-hover:bg-primary/60 transition-colors" />
                  
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-6">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-primary/70 uppercase tracking-widest border border-primary/20 px-1 bg-primary/5">
                            {pick.sport}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                            ID: {pick.id.substring(0,6)}
                          </span>
                        </div>
                        <h3 className={`text-xl font-bold text-white mt-2 ${pick.isLocked ? "redacted" : ""}`}>
                          {pick.playerName}
                        </h3>
                      </div>
                      
                      {pick.isLocked ? (
                        <div className="h-8 w-8 rounded-sm bg-black border border-white/10 flex items-center justify-center">
                          <Lock className="h-4 w-4 text-muted-foreground" />
                        </div>
                      ) : (
                        <div className="flex gap-4 items-end text-right">
                          <div className="flex flex-col items-end">
                            <div className="text-xl font-mono text-white">{Math.round(pick.confidence * 0.95)}%</div>
                            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Win Prob</div>
                          </div>
                          <div className="flex flex-col items-end">
                            <div className="text-2xl font-mono text-primary font-bold">{pick.confidence}%</div>
                            <div className="text-[10px] font-mono text-primary/70 uppercase tracking-widest">Sys. Conf</div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-4 font-mono text-sm mt-8">
                      <div className="flex justify-between border-b border-white/5 pb-3">
                        <span className="text-muted-foreground flex items-center gap-2">
                          <TargetIcon /> Market
                        </span>
                        <span className={`text-white text-right ${pick.isLocked ? "redacted" : ""}`}>
                          {pick.propType}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-white/5 pb-3">
                        <span className="text-muted-foreground flex items-center gap-2">
                          <Crosshair className="h-4 w-4" /> Target Line
                        </span>
                        <span className={`text-white font-bold ${pick.isLocked ? "redacted" : ""}`}>
                          {pick.direction} {pick.line}
                        </span>
                      </div>
                      <div className="flex justify-between pb-1">
                        <span className="text-muted-foreground flex items-center gap-2">
                          <RiskIcon tier={pick.riskTier} /> Strategy
                        </span>
                        <span className={`text-white ${pick.isLocked ? "redacted" : ""}`}>
                          {pick.riskTier}
                        </span>
                      </div>
                    </div>
                  </div>

                  {pick.isLocked && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-[4px] flex flex-col items-center justify-center p-6 text-center border-t border-t-primary/50">
                      <Lock className="h-10 w-10 text-primary mb-4" />
                      <h4 className="text-lg font-sans font-bold text-white tracking-widest uppercase mb-2">Classified Intel</h4>
                      <p className="text-xs font-mono text-muted-foreground mb-6">Upgrade to Level 5 clearance to decrypt this signal.</p>
                      <Button variant="outline" size="sm" className="gap-2 bg-black hover:bg-primary hover:text-black transition-all">
                        Upgrade Clearance <ArrowUpRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {(!picksData || picksData.picks.length === 0) && (
              <div className="py-24 text-center border border-white/10 bg-card">
                <ShieldAlert className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="text-xl font-sans font-bold text-white uppercase tracking-widest mb-2">No Active Signals</h3>
                <p className="text-muted-foreground font-mono text-sm max-w-md mx-auto">
                  The system is currently scanning markets. Check back later or ensure your notification alerts are active.
                </p>
              </div>
            )}
            
            {picksData && picksData.lockedCount > 0 && (
              <div className="mt-12 p-8 border border-primary/20 bg-primary/5 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
                <div className="absolute right-0 top-0 w-64 h-full bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
                <div className="space-y-2 relative z-10">
                  <h3 className="text-2xl font-bold font-sans uppercase tracking-widest text-white text-glow">
                    {picksData.lockedCount} Signals Encrypted
                  </h3>
                  <p className="text-muted-foreground font-mono text-sm max-w-xl">
                    Your current authorization level restricts access to high-value intercepts. Request an upgrade to decrypt the full terminal view.
                  </p>
                </div>
                <Button size="lg" className="shrink-0 relative z-10 box-glow gap-2">
                  Request Upgrade <Lock className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TargetIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
  );
}

function RiskIcon({ tier }: { tier: string }) {
  if (tier === "Safe") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (tier === "Aggressive") return <AlertTriangle className="h-4 w-4 text-red-500" />;
  return <Activity className="h-4 w-4 text-yellow-500" />;
}
