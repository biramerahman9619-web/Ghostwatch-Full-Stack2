import { Link, useLocation } from "wouter";
import { Ghost, Activity, Zap, Radio, Bot, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@workspace/replit-auth-web";

const NAV_ITEMS = [
  { href: "/", label: "Ghostwatch", icon: Ghost, desc: "Picks & Projections" },
  { href: "/ghost-express", label: "Ghost Express", icon: Activity, desc: "Live In-Game AI" },
  { href: "/ghostspere", label: "Ghostspere", icon: Zap, desc: "Automation Butler" },
  { href: "/ghostobservation", label: "Ghostobservation", icon: Radio, desc: "Social & News Intel" },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  return (
    <div className="w-64 flex flex-col bg-card border-r border-border h-[100dvh] sticky top-0 shrink-0">
      <div className="p-6 pb-2">
        <Link href="/" className="flex items-center gap-3 no-underline group">
          <div className="bg-primary/10 p-2 rounded-lg border border-primary/20 group-hover:border-primary/50 transition-colors">
            <Ghost className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-tight text-foreground leading-none">Ghostwatch</h1>
            <span className="text-[10px] uppercase tracking-widest text-primary font-mono mt-1 block">Terminal v1.0</span>
          </div>
        </Link>
      </div>

      <div className="px-4 py-6 flex-1 flex flex-col gap-2 overflow-y-auto scrollbar-hide">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2 px-2">Modules</div>
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-3 rounded-md transition-colors border",
                isActive 
                  ? "bg-primary/10 border-primary/30 text-primary" 
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              <Icon className="w-5 h-5" />
              <div className="flex flex-col">
                <span className="font-medium text-sm leading-none mb-1">{item.label}</span>
                <span className="text-[10px] font-mono opacity-70">{item.desc}</span>
              </div>
            </Link>
          );
        })}

        <div className="mt-6 mb-2 px-2 text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Bot className="w-3.5 h-3.5" /> Intelligence
        </div>
        
        <Link
          href="/ghostphere-ai"
          className={cn(
            "flex items-center gap-3 px-3 py-3 rounded-md transition-colors border group",
            location.startsWith("/ghostphere-ai")
              ? "bg-accent/20 border-accent/40 text-accent-foreground" 
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          )}
        >
          <div className="relative">
            <Ghost className="w-5 h-5 group-hover:animate-pulse" />
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-accent rounded-full animate-ping-slow" />
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-accent rounded-full" />
          </div>
          <div className="flex flex-col">
            <span className="font-medium text-sm leading-none mb-1">Ghostphere AI</span>
            <span className="text-[10px] font-mono opacity-70">Conversational Engine</span>
          </div>
        </Link>
      </div>

      <div className="p-4 border-t border-border mt-auto shrink-0 bg-card">
        {/* User Profile / Auth Status */}
        <div className="flex items-center gap-3 mb-4 px-2">
          {user?.profileImageUrl ? (
            <img src={user.profileImageUrl} alt={user.firstName || 'User'} className="w-8 h-8 rounded-full border border-border" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center border border-border text-xs font-bold">
              {user?.firstName?.charAt(0) || 'U'}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{user?.firstName || 'Agent'} {user?.lastName || ''}</div>
            <div className="text-[10px] font-mono text-muted-foreground truncate">Clearance: ACTIVE</div>
          </div>
          <button 
            onClick={logout}
            className="p-2 hover:bg-destructive/10 hover:text-destructive text-muted-foreground rounded-md transition-colors"
            title="Disconnect"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-secondary/50 rounded-md p-3 border border-border/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground font-mono">System Status</span>
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-safe opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-safe"></span>
              </span>
              <span className="text-xs text-safe font-mono uppercase">Online</span>
            </div>
          </div>
          <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-safe w-full"></div>
          </div>
        </div>
      </div>
    </div>
  );
}