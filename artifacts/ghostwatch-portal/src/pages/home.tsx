import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useGetPortalStats, useGetPortalPicksPreview, usePortalSubscribe } from "@workspace/api-client-react";
import { ArrowRight, Activity, Users, Target, ShieldAlert, ChevronDown, Flame, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const { data: stats } = useGetPortalStats();
  const { data: picksData } = useGetPortalPicksPreview();
  const subscribe = usePortalSubscribe();
  const { toast } = useToast();

  const [email, setEmail] = useState("");

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    
    subscribe.mutate({ data: { email } }, {
      onSuccess: (res) => {
        toast({
          title: "Intercept Confirmed",
          description: res.message || "You are now on the distribution list.",
        });
        setEmail("");
      },
      onError: (err: any) => {
        toast({
          title: "Transmission Failed",
          description: err.message || "Failed to subscribe.",
          variant: "destructive"
        });
      }
    });
  };

  return (
    <div className="flex flex-col w-full">
      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex items-center border-b border-white/5 overflow-hidden">
        {/* Abstract background elements */}
        <div className="absolute top-1/4 right-1/4 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        
        <div className="container mx-auto px-4 md:px-6 relative z-10 pt-20 pb-20">
          <div className="max-w-4xl space-y-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 border border-primary/30 bg-primary/5 text-primary text-xs font-mono tracking-widest uppercase">
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
              Intelligence Leak Detected
            </div>
            
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold font-sans tracking-tight text-white leading-[1.1] text-glow">
              CLASSIFIED INTEL.<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-primary/50">
                DECLASSIFIED FOR YOU.
              </span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground font-mono max-w-2xl leading-relaxed">
              We intercept live data. We find the mismatches. We feed you the signals before the lines adjust. Welcome to the war room.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
              <Button asChild size="lg" className="w-full sm:w-auto gap-2 text-lg">
                <Link href="/picks">
                  Access Live Feeds <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link href="/login">
                  Authorize Agent
                </Link>
              </Button>
            </div>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-muted-foreground animate-bounce">
          <ChevronDown className="h-6 w-6" />
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-20 border-b border-white/5 bg-black/50 backdrop-blur-sm relative">
        <div className="absolute top-0 left-0 w-full h-full bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
        <div className="container mx-auto px-4 md:px-6 relative z-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            <StatCard 
              icon={<Activity className="h-6 w-6 text-primary" />}
              value={stats?.picksToday || "--"}
              label="Signals Intercepted Today"
            />
            <StatCard 
              icon={<Flame className="h-6 w-6 text-primary" />}
              value={stats?.sportsLive || "--"}
              label="Active Operations"
            />
            <StatCard 
              icon={<Users className="h-6 w-6 text-primary" />}
              value={stats?.subscribers || "--"}
              label="Operatives Active"
            />
            <StatCard 
              icon={<Target className="h-6 w-6 text-primary" />}
              value={stats?.avgConfidence ? `${stats.avgConfidence}%` : "--%"}
              label="System Confidence"
            />
          </div>
        </div>
      </section>

      {/* Live Preview Section */}
      <section className="py-24 relative overflow-hidden">
        <div className="container mx-auto px-4 md:px-6 relative z-10">
          <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-12">
            <div className="space-y-4">
              <h2 className="text-3xl md:text-4xl font-bold font-sans uppercase tracking-widest text-white">
                Live Intercepts
              </h2>
              <p className="text-muted-foreground font-mono text-sm">
                Real-time sample of currently active signals. Full clearance required to unredact.
              </p>
            </div>
            <Button asChild variant="outline" className="gap-2">
              <Link href="/picks">
                View All {picksData?.totalAvailable || 0} Signals <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {picksData?.picks.slice(0, 6).map((pick) => (
              <div key={pick.id} className="border border-white/10 bg-card p-6 relative group overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                
                <div className="flex justify-between items-start mb-6">
                  <div className="space-y-1">
                    <span className="text-xs font-mono text-primary/70 uppercase tracking-wider">{pick.sport}</span>
                    <h3 className={`text-xl font-bold text-white ${pick.isLocked ? "redacted" : ""}`}>
                      {pick.playerName}
                    </h3>
                  </div>
                  <div className="bg-primary/10 border border-primary/20 px-2 py-1 text-xs font-mono text-primary">
                    {pick.confidence}% CONF
                  </div>
                </div>

                <div className="space-y-4 font-mono text-sm">
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-muted-foreground">Market</span>
                    <span className={`text-white text-right ${pick.isLocked ? "redacted" : ""}`}>
                      {pick.propType}
                    </span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-muted-foreground">Line</span>
                    <span className={`text-white font-bold ${pick.isLocked ? "redacted" : ""}`}>
                      {pick.direction} {pick.line}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Risk Tier</span>
                    <span className={`text-white ${pick.isLocked ? "redacted" : ""}`}>
                      {pick.riskTier}
                    </span>
                  </div>
                </div>

                {pick.isLocked && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-6 text-center">
                    <div className="space-y-3">
                      <Lock className="h-8 w-8 text-primary mx-auto opacity-80" />
                      <div className="text-xs font-mono text-white tracking-widest uppercase">Clearance Required</div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            
            {(!picksData || picksData.picks.length === 0) && (
              <div className="col-span-full py-12 text-center border border-white/10 bg-black/20">
                <ShieldAlert className="h-10 w-10 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-muted-foreground font-mono uppercase tracking-widest text-sm">No signals currently in intercept window</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Subscribe Section */}
      <section className="py-24 border-t border-white/5 bg-primary/5 relative">
        <div className="container mx-auto px-4 md:px-6 relative z-10 max-w-3xl text-center space-y-8">
          <ShieldAlert className="h-12 w-12 text-primary mx-auto" />
          <h2 className="text-3xl md:text-5xl font-bold font-sans uppercase tracking-widest text-white text-glow">
            Get The Daily Briefing
          </h2>
          <p className="text-muted-foreground font-mono">
            We drop the day's highest confidence signals straight to your inbox before the market adjusts. Zero noise. Pure intel.
          </p>

          <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-4 max-w-xl mx-auto pt-6">
            <Input 
              type="email" 
              placeholder="AGENT_EMAIL@NODE.COM" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-14 font-mono uppercase bg-black/50"
            />
            <Button type="submit" size="lg" className="h-14 sm:w-auto w-full px-8 shrink-0" disabled={subscribe.isPending}>
              {subscribe.isPending ? "TRANSMITTING..." : "ENLIST"}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground font-mono uppercase tracking-widest">
            100% SECURE. UNSUBSCRIBE ANYTIME.
          </p>
        </div>
      </section>
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: React.ReactNode, value: string | number, label: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-12 w-12 rounded-sm border border-primary/20 bg-primary/5 flex items-center justify-center">
        {icon}
      </div>
      <div>
        <div className="text-4xl font-bold font-mono text-white mb-2 tracking-tight">{value}</div>
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">{label}</div>
      </div>
    </div>
  );
}
