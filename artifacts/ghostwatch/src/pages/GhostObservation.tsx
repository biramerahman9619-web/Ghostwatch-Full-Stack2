import { useListAlerts, useListTeamPulse } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radio, AlertCircle, HeartPulse, UserCircle2, Plane, MessageSquareWarning, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

function AlertCard({ alert }: { alert: any }) {
  let Icon = AlertCircle;
  let severityColor = "text-primary border-primary/20 bg-primary/5";
  
  if (alert.severity === 'High') {
    severityColor = "text-destructive border-destructive/20 bg-destructive/5";
  } else if (alert.severity === 'Medium') {
    severityColor = "text-balanced border-balanced/20 bg-balanced/5";
  }

  if (alert.alertType === 'PartyRisk' || alert.alertType === 'DramaAlert') Icon = MessageSquareWarning;
  if (alert.alertType === 'FatigueRisk' || alert.alertType === 'InjuryConcern') Icon = HeartPulse;
  if (alert.alertType === 'TravelFatigue') Icon = Plane;

  return (
    <Card className={cn("border transition-colors", severityColor)}>
      <CardContent className="p-4 flex gap-4 items-start">
        <div className="mt-1">
          <Icon className="w-5 h-5 opacity-80" />
        </div>
        <div className="flex-1">
          <div className="flex justify-between items-start mb-1">
            <h4 className="font-bold text-sm tracking-tight text-foreground">{alert.playerName} <span className="text-muted-foreground font-normal text-xs ml-1">({alert.team})</span></h4>
            <Badge variant="outline" className="text-[9px] uppercase font-mono tracking-widest border-current opacity-80">
              {alert.alertType}
            </Badge>
          </div>
          <p className="text-xs text-foreground/80 leading-relaxed mb-2">{alert.description}</p>
          <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            <span>Source: {alert.source || 'Scraped Intel'}</span>
            <span>{new Date(alert.createdAt).toLocaleTimeString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TeamPulseCard({ team }: { team: any }) {
  const getFatigueColor = (f: string) => {
    if (f === 'Severe') return 'text-destructive';
    if (f === 'Moderate') return 'text-balanced';
    return 'text-safe';
  };

  return (
    <Card className="bg-card/50 border-border/50">
      <CardContent className="p-4">
        <div className="flex justify-between items-center mb-4">
          <h4 className="font-bold text-lg">{team.teamName}</h4>
          <Badge variant="outline" className="font-mono text-[10px] uppercase bg-secondary/50">
            Chem Score: <span className="text-primary ml-1">{team.chemistryScore}</span>
          </Badge>
        </div>
        
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-secondary/30 p-2 rounded border border-border/30">
            <div className="text-[10px] font-mono uppercase text-muted-foreground mb-1">Travel Fatigue</div>
            <div className={cn("text-sm font-bold", getFatigueColor(team.travelFatigue))}>
              {team.travelFatigue}
            </div>
          </div>
          <div className="bg-secondary/30 p-2 rounded border border-border/30">
            <div className="text-[10px] font-mono uppercase text-muted-foreground mb-1">Drama Level</div>
            <div className={cn("text-sm font-bold", team.dramaLevel === 'High' ? 'text-destructive' : 'text-foreground')}>
              {team.dramaLevel}
            </div>
          </div>
        </div>

        {team.notes && (
          <p className="text-xs text-muted-foreground font-mono border-l-2 border-primary/30 pl-2 py-1">
            {team.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function GhostObservation() {
  const { data: alerts, isLoading: loadingAlerts } = useListAlerts();
  const { data: teamPulses, isLoading: loadingPulses } = useListTeamPulse();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="border-b border-border bg-card p-6 flex-shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Radio className="w-6 h-6 text-primary" />
          Ghostobservation
        </h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">Social Intel, Travel Fatigue & Market Sentiment</p>
      </header>

      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Column: Player Alerts */}
        <div className="w-2/3 border-r border-border bg-background flex flex-col">
          <div className="p-4 border-b border-border/50 flex-shrink-0 flex justify-between items-center">
            <h2 className="text-sm font-mono text-foreground uppercase tracking-widest flex items-center gap-2">
              <UserCircle2 className="w-4 h-4 text-primary" />
              Real-time Player Intel
            </h2>
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-destructive animate-pulse"></span>
              Live Monitoring
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6">
            {loadingAlerts ? (
              <div className="space-y-4">
                {[1,2,3].map(i => <Card key={i} className="h-24 animate-pulse bg-secondary/30" />)}
              </div>
            ) : alerts?.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground font-mono border border-dashed border-border rounded-lg p-12">
                No active player alerts detected in the social sphere.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {alerts?.map(alert => (
                  <AlertCard key={alert.id} alert={alert} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Team Pulse */}
        <div className="w-1/3 bg-card/20 flex flex-col">
          <div className="p-4 border-b border-border/50 flex-shrink-0">
            <h2 className="text-sm font-mono text-foreground uppercase tracking-widest flex items-center gap-2">
              <HeartPulse className="w-4 h-4 text-primary" />
              Team Pulse & Chemistry
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loadingPulses ? (
              [1,2].map(i => <Card key={i} className="h-40 animate-pulse bg-secondary/50" />)
            ) : teamPulses?.length === 0 ? (
              <div className="text-center text-muted-foreground font-mono text-sm p-8">
                No team pulse data available.
              </div>
            ) : (
              teamPulses?.map(team => (
                <TeamPulseCard key={team.teamId} team={team} />
              ))
            )}
            
            <div className="mt-8 p-4 bg-secondary/20 border border-primary/20 rounded-lg">
              <h4 className="text-xs font-mono uppercase tracking-widest text-primary mb-2 flex items-center gap-2">
                <Zap className="w-3 h-3" /> Integration Note
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed font-mono">
                Social intel from Ghostobservation is automatically factored into Ghostwatch AI projections. High severity alerts apply a negative multiplier to a player's baseline projection, shifting their risk tier to Aggressive.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
