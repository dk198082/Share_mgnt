import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@workspace/replit-auth-web';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EmployeeGate } from '@/components/gate';
import { Brand } from '@/components/shell';
import { Button } from '@/components/ui/button';
import NotFound from '@/pages/not-found';
import Landing from '@/pages/landing';
import Home from '@/pages/home';
import Shareholders from '@/pages/shareholders';
import ShareholderEditor from '@/pages/shareholder-editor';
import SignOffRequests from '@/pages/sign-off-requests';
import Transfers from '@/pages/transfers';
import Certificates from '@/pages/certificates';
import Settings from '@/pages/settings';
import SharePrices from '@/pages/share-prices';
import Reports from '@/pages/reports';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function SignInPage() {
  const { user, isLoading, error, login, reload } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const target = params.get('redirect_url') || `${basePath}/home`;
  const safeTarget = target.startsWith('/') && !target.startsWith('//') && !target.includes('\\') ? target : `${basePath}/home`;
  const callbackFailed = params.has('error');
  const embedded = window.top !== window.self;
  const redirectStarted = useRef(false);
  useEffect(() => {
    if (embedded || isLoading || user || error || callbackFailed || redirectStarted.current) return;
    redirectStarted.current = true;
    login(safeTarget);
  }, [embedded, isLoading, user, error, callbackFailed, login, safeTarget]);
  if (user) return <Redirect to={basePath && safeTarget.startsWith(basePath + '/') ? safeTarget.slice(basePath.length) : safeTarget} />;
  if (!error && !callbackFailed && !embedded) return <div className="p-10 text-sm text-muted-foreground" role="status">Redirecting to Microsoft sign-in…</div>;
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-card-border bg-card p-8 shadow-lg">
        <Brand light={false} />
        <h1 className="mt-8 font-display text-3xl">{error || callbackFailed ? 'Unable to sign in' : 'Sign in with Microsoft'}</h1>
        {embedded && !error && !callbackFailed && <p className="mt-4 text-sm text-muted-foreground">Microsoft sign-in opens in a new tab from the embedded preview.</p>}
        {callbackFailed && <p role="alert" className="mt-4 text-sm text-destructive">Sign-in could not be completed or expired. Please try again.</p>}
        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
        <Button className="mt-6 w-full" disabled={isLoading} onClick={() => error ? reload() : login(safeTarget)} data-testid="login-btn">
          {isLoading ? 'Checking sign-in…' : error || callbackFailed ? 'Try again' : 'Continue with Microsoft'}
        </Button>
      </div>
    </div>
  );
}
function HomeRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;
  return user ? <Redirect to="/home" /> : <Landing />;
}
const gated = (C: ComponentType) => () => <EmployeeGate><C /></EmployeeGate>;
const HomeRoute = gated(Home);
const SignOffRoute = gated(SignOffRequests);
const TransfersRoute = gated(Transfers);
const CertificatesRoute = gated(Certificates);
const ShareholdersRoute = gated(Shareholders);
const EditorRoute = gated(ShareholderEditor);
const SettingsRoute = gated(Settings);
const SharePricesRoute = gated(SharePrices);
const ReportsRoute = gated(Reports);

function IdentityCacheInvalidator() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = user?.id ?? null;
    if (previous.current !== undefined && previous.current !== id) qc.clear();
    previous.current = id;
  }, [user?.id, qc]);
  return null;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
export default function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider basePath={basePath}>
          <IdentityCacheInvalidator />
          <TooltipProvider>
            <RoutedErrorBoundary>
              <Switch>
                <Route path="/" component={HomeRedirect} />
                <Route path="/sign-in/*?" component={SignInPage} />
                <Route path="/sign-up/*?" component={SignInPage} />
                <Route path="/home" component={HomeRoute} />
                <Route path="/transfer-requests"><Redirect to="/sign-off-requests" replace /></Route>
                <Route path="/transfer-requests/:requestId" component={SignOffRoute} />
                <Route path="/sign-off-requests" component={SignOffRoute} />
                <Route path="/sign-off-requests/:requestId" component={SignOffRoute} />
                <Route path="/transfers" component={TransfersRoute} />
                <Route path="/transfers/:id" component={TransfersRoute} />
                <Route path="/certificates" component={CertificatesRoute} />
                <Route path="/shareholders" component={ShareholdersRoute} />
                <Route path="/shareholders/new" component={EditorRoute} />
                <Route path="/shareholders/:id" component={EditorRoute} />
                <Route path="/reports" component={ReportsRoute} />
                <Route path="/settings" component={SettingsRoute} />
                <Route path="/share-prices" component={SharePricesRoute} />
                <Route component={NotFound} />
              </Switch>
            </RoutedErrorBoundary>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}
