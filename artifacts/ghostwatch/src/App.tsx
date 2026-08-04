import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Shell } from './components/layout/Shell';
import { useAuth } from '@workspace/replit-auth-web';
import { setBaseUrl } from '@workspace/api-client-react';

// When deployed to Netlify (or any external host), point the API client at the
// deployed Replit backend.  Set VITE_API_BASE_URL in Netlify → Site settings →
// Environment variables to your backend's deployed URL, e.g.:
//   https://ghostwatch-api.yourusername.replit.app
if (import.meta.env.VITE_API_BASE_URL) {
  setBaseUrl(import.meta.env.VITE_API_BASE_URL as string);
}

// Pages
import Dashboard from './pages/Dashboard';
import GhostExpress from './pages/GhostExpress';
import Ghostspere from './pages/Ghostspere';
import GhostObservation from './pages/GhostObservation';
import Cover from './pages/Cover';
import GhostphereAI from './pages/GhostphereAI';
import { Loader2 } from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60, // 1 minute
    },
  },
});

function NotFound() {
  return (
    <div className="flex-1 flex items-center justify-center flex-col gap-4 h-full">
      <h1 className="text-4xl font-mono text-primary">404</h1>
      <p className="text-muted-foreground">Signal lost. Page not found.</p>
    </div>
  );
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background text-foreground selection:bg-primary/30">
        <div className="bg-primary/10 p-4 rounded-xl border border-primary/20 animate-pulse mb-6">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
        <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Establishing secure connection...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="*" component={Cover} />
      </Switch>
    );
  }

  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/ghost-express" component={GhostExpress} />
        <Route path="/ghostspere" component={Ghostspere} />
        <Route path="/ghostobservation" component={GhostObservation} />
        <Route path="/ghostphere-ai" component={GhostphereAI} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, '') || ''}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;