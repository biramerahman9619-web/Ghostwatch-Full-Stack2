import { useListTickets, useSendTicketEmail, useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, Mail, Settings2, ShieldCheck, Zap, SplitSquareHorizontal, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSettingsQueryKey } from "@workspace/api-client-react";

function TicketCard({ ticket, onSelect, isSelected }: { ticket: any, onSelect: () => void, isSelected: boolean }) {
  let tierColor = "border-primary/30 text-primary";
  if (ticket.riskTier === 'Safe') tierColor = "border-safe/30 text-safe";
  if (ticket.riskTier === 'Aggressive') tierColor = "border-aggressive/30 text-aggressive";
  if (ticket.riskTier === 'Balanced') tierColor = "border-balanced/30 text-balanced";

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
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("font-mono uppercase bg-background", tierColor)}>
              {ticket.riskTier} PARLAY
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">{ticket.sport}</span>
          </div>
          <div className="text-right">
            <div className="text-sm font-mono text-muted-foreground uppercase">Win Prob</div>
            <div className="font-mono font-bold text-lg">{ticket.combinedConfidence}%</div>
          </div>
        </div>

        <div className="space-y-3">
          {ticket.picks.map((pick: any, i: number) => (
            <div key={i} className="flex justify-between items-center text-sm">
              <div>
                <span className="font-bold">{pick.playerName}</span>
                <span className="text-muted-foreground ml-2">{pick.propType}</span>
              </div>
              <div className="font-mono font-medium text-primary">
                {pick.direction === 'Over' ? 'O' : 'U'} {pick.line}
              </div>
            </div>
          ))}
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
  const [editRisk, setEditRisk] = useState<any>("Balanced");
  const [editPicks, setEditPicks] = useState<number>(3);

  // Sync settings when loaded
  useEffect(() => {
    if (settings) {
      setEditEmail(settings.email || "");
      setEditRisk(settings.riskProfile || "Balanced");
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
      onSuccess: () => {
        toast({
          title: "Tickets dispatched",
          description: `Sent ${selectedTickets.size} ticket${selectedTickets.size !== 1 ? 's' : ''} to ${settings.email}`,
          className: "border-primary bg-card text-primary font-mono",
        });
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
        riskProfile: editRisk,
        picksPerTicket: editPicks,
      }
    }, {
      onSuccess: () => {
        toast({
          title: "Protocol Updated",
          description: "Butler settings have been saved successfully.",
          className: "border-primary bg-card text-primary font-mono",
        });
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      }
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
          <p className="text-sm text-muted-foreground font-mono mt-1">Automated Ticket Construction & Dispatch</p>
        </div>
        <Button 
          onClick={handleSend} 
          disabled={selectedTickets.size === 0 || sendEmail.isPending}
          className="font-mono uppercase tracking-widest gap-2"
        >
          <Mail className="w-4 h-4" />
          {sendEmail.isPending ? 'Dispatching...' : `Dispatch Tickets (${selectedTickets.size})`}
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 flex gap-6">
        
        {/* Main Content: Tickets */}
        <div className="flex-1">
          <h2 className="text-sm font-mono text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2">
            <SplitSquareHorizontal className="w-4 h-4 text-primary" />
            Today's Butler Tickets
          </h2>

          {loadingTickets ? (
            <div className="grid grid-cols-2 gap-4">
              {[1,2,3,4].map(i => <Card key={i} className="h-48 animate-pulse bg-secondary/30" />)}
            </div>
          ) : tickets?.length === 0 ? (
            <div className="p-12 border border-dashed border-border rounded-lg text-center text-muted-foreground font-mono flex flex-col items-center">
              <Bot className="w-12 h-12 mb-4 opacity-50 text-primary" />
              <p>No tickets constructed yet.</p>
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
                <label className="text-[10px] uppercase font-mono text-muted-foreground tracking-widest mb-2 block">Risk Profile</label>
                <div className="flex items-center gap-2 bg-secondary/30 p-1 rounded-md border border-border">
                  {['Safe', 'Balanced', 'Aggressive'].map(tier => (
                    <button 
                      key={tier}
                      onClick={() => setEditRisk(tier)}
                      className={cn(
                        "flex-1 text-center py-1.5 text-xs font-mono uppercase rounded transition-colors",
                        editRisk === tier ? "bg-primary text-primary-foreground font-bold shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tier}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-mono text-muted-foreground tracking-widest mb-2 block">Picks per Ticket ({editPicks})</label>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground">3</span>
                  <input 
                    type="range" 
                    min="3" 
                    max="6" 
                    value={editPicks}
                    onChange={(e) => setEditPicks(Number(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <span className="text-xs font-mono text-muted-foreground">6</span>
                </div>
                <div className="flex justify-between mt-1">
                  {[3,4,5,6].map(n => (
                    <button
                      key={n}
                      onClick={() => setEditPicks(n)}
                      className={cn(
                        "text-[10px] font-mono px-2 py-0.5 rounded transition-colors",
                        editPicks === n ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {n}
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
