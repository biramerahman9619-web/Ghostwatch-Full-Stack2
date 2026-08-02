import { useAuth } from "@workspace/replit-auth-web";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { Shield, Fingerprint, Lock, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Login() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isAuthenticated) {
      setLocation("/picks");
    }
  }, [isAuthenticated, setLocation]);

  return (
    <div className="flex-1 flex items-center justify-center relative p-4 overflow-hidden">
      {/* Background decorations */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
      
      <div className="w-full max-w-md relative z-10">
        <div className="border border-white/10 bg-black/40 backdrop-blur-xl p-8 relative">
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-primary/50" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-primary/50" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-primary/50" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-primary/50" />

          <div className="flex flex-col items-center text-center space-y-6">
            <div className="h-20 w-20 rounded-full border border-primary/30 flex items-center justify-center bg-primary/5 box-glow relative">
              <Shield className="h-8 w-8 text-primary animate-pulse" />
              <div className="absolute inset-0 rounded-full border border-primary/20 animate-[spin_4s_linear_infinite]" style={{ borderTopColor: 'transparent', borderRightColor: 'transparent' }} />
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-widest font-sans text-white text-glow uppercase">
                Restricted Area
              </h1>
              <p className="text-muted-foreground font-mono text-sm max-w-sm mx-auto">
                Access to the Ghostwatch Intelligence Network requires Level 4 Authorization. Please authenticate to proceed.
              </p>
            </div>

            <div className="w-full space-y-4 pt-4">
              <div className="bg-primary/5 border border-primary/10 rounded-sm p-4 font-mono text-xs text-left space-y-2 text-primary/70">
                <div className="flex items-center gap-2">
                  <Terminal className="h-3 w-3" />
                  <span>Establishing secure connection...</span>
                </div>
                <div className="flex items-center gap-2">
                  <Lock className="h-3 w-3" />
                  <span>Awaiting identity verification</span>
                </div>
              </div>

              <Button 
                className="w-full gap-2 text-lg h-14" 
                onClick={() => login()}
                disabled={isLoading}
              >
                <Fingerprint className="h-5 w-5" />
                {isLoading ? "Authenticating..." : "Initialize Handshake"}
              </Button>
            </div>
            
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mt-8">
              Warning: Unauthorized access attempts are monitored and logged.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
