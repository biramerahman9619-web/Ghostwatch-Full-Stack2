import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Shell } from './components/layout/Shell';

// Pages
import Dashboard from './pages/Dashboard';
import GhostExpress from './pages/GhostExpress';
import Ghostspere from './pages/Ghostspere';
import GhostObservation from './pages/GhostObservation';

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
    <div className="flex-1 flex items-center justify-center flex-col gap-4">
      <h1 className="text-4xl font-mono text-primary">404</h1>
      <p className="text-muted-foreground">Signal lost. Page not found.</p>
    </div>
  );
}

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/ghost-express" component={GhostExpress} />
        <Route path="/ghostspere" component={Ghostspere} />
        <Route path="/ghostobservation" component={GhostObservation} />
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
