import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { ShieldAlert, LogOut, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";

export function Layout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, logout, user } = useAuth();

  return (
    <div className="min-h-[100dvh] flex flex-col noise-bg selection:bg-primary selection:text-black">
      {/* Scanline overlay */}
      <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
        <div className="h-2 w-full bg-primary/10 opacity-50 animate-scanline shadow-[0_0_20px_hsl(var(--primary))]"></div>
      </div>

      <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2 group">
            <ShieldAlert className="h-6 w-6 text-primary group-hover:animate-glitch" />
            <span className="font-sans font-bold tracking-widest text-lg text-white group-hover:text-primary transition-colors">
              GHOSTWATCH
            </span>
          </Link>
          
          <nav className="flex items-center gap-6">
            <Link 
              href="/picks" 
              className="text-sm font-mono uppercase tracking-widest text-muted-foreground hover:text-white transition-colors"
            >
              Live Feeds
            </Link>
            
            {isAuthenticated ? (
              <div className="flex items-center gap-4">
                <div className="hidden md:flex items-center gap-2 text-xs font-mono text-primary/70">
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
                  AGENT: {user?.firstName?.toUpperCase() || user?.email?.split('@')[0].toUpperCase() || 'UNKNOWN'}
                </div>
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={() => logout()}
                  title="Disconnect Session"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button asChild variant="outline" size="sm" className="gap-2 group">
                <Link href="/login">
                  AUTHORIZE <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        {children}
      </main>

      <footer className="border-t border-white/5 bg-background py-8">
        <div className="container mx-auto px-4 md:px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-mono text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 opacity-50" />
            <span>GHOSTWATCH INTELLIGENCE NETWORK // {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-4">
            <span>SECURE CONNECTION</span>
            <span className="text-primary/50">NODE: 0x48A9</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
