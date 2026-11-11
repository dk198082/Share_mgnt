import type { ReactNode } from 'react';
import { Redirect } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AppShell, Brand } from '@/components/shell';

export function EmployeeGate({ children }: { children: ReactNode }) {
  const { user, isLoading, error, reload } = useAuth();
  if (isLoading) return <div className="space-y-4 p-10"><Skeleton className="h-9 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (error) return <div className="mx-auto max-w-md p-10"><Brand light={false} /><h1 className="mt-6 font-display text-2xl">Sign-in could not be checked</h1><p className="mt-3 text-sm">{error}</p><Button className="mt-5" onClick={reload}>Try again</Button></div>;
  if (!user) return <Redirect to={`/sign-in?redirect_url=${encodeURIComponent(window.location.pathname + window.location.search)}`} />;
  return <AppShell>{children}</AppShell>;
}
