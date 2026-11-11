import { Link } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';
import { useGetSummary, useListActivity, useListShareholders } from '@workspace/api-client-react';
import { ArrowRight, History, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shell';
import { nf, relTime, totalShares, initials } from '@/lib/format';

function Stat({ label, value, loading, tone }: { label: string; value?: number; loading: boolean; tone: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-card-border bg-card p-5">
      <span className={`absolute inset-x-0 top-0 h-[3px] ${tone}`} />
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      {loading ? <Skeleton className="mt-3 h-8 w-20" /> : (
        <div className="mt-2 font-display text-3xl tnum" data-testid={`stat-${label.toLowerCase().replace(/\s/g, '-')}`}>{nf.format(value ?? 0)}</div>
      )}
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const summary = useGetSummary();
  const activity = useListActivity();
  const list = useListShareholders();
  const s = summary.data;
  const top = [...(list.data ?? [])].sort((a, b) => totalShares(b.shares) - totalShares(a.shares)).slice(0, 5);
  const grand = s?.totalShares || 1;

  return (
    <div>
      <PageHeader
        eyebrow={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        title={<>Good to see you{user?.firstName ? `, ${user.firstName}` : ''}.</>}
        actions={<Link href="/shareholders/new" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90" data-testid="link-new-shareholder"><Plus className="h-4 w-4" /> New shareholder</Link>}
      />
      <div className="space-y-8 px-6 py-8 md:px-10">
        {summary.isError ? (
          <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <span>Totals couldn't be loaded.</span>
            <Button size="sm" variant="outline" onClick={() => summary.refetch()}><RefreshCw className="mr-2 h-3.5 w-3.5" />Retry</Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Shareholders" value={s?.totalShareholders} loading={summary.isLoading} tone="bg-primary" />
            <Stat label="Total shares" value={s?.totalShares} loading={summary.isLoading} tone="bg-accent" />
            <Stat label="Family lines" value={s?.familyLines} loading={summary.isLoading} tone="bg-chart-3" />
            <Stat label="Documents" value={s?.documents} loading={summary.isLoading} tone="bg-chart-4" />
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <section className="rounded-lg border border-card-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="font-display text-lg">Largest holdings</h2>
              <Link href="/shareholders" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">Full registry <ArrowRight className="h-3 w-3" /></Link>
            </div>
            {list.isLoading ? (
              <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : list.isError ? (
              <div className="p-5 text-sm text-muted-foreground">Couldn't load shareholders. <button className="text-accent underline" onClick={() => list.refetch()}>Retry</button></div>
            ) : top.length === 0 ? (
              <div className="p-10 text-center">
                <div className="font-display text-lg">The registry is empty.</div>
                <p className="mt-1 text-sm text-muted-foreground">Add the first shareholder to begin.</p>
                <Link href="/shareholders/new" className="mt-4 inline-flex items-center gap-1 text-sm text-accent hover:underline"><Plus className="h-3.5 w-3.5" /> Add shareholder</Link>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {top.map((sh) => {
                  const t = totalShares(sh.shares);
                  return (
                    <li key={sh.id}>
                      <Link href={`/shareholders/${sh.id}`} className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-secondary/50">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(sh.name)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{sh.name}</div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                            <div className="h-full origin-left rounded-full bg-accent transition-transform duration-700" style={{ transform: `scaleX(${Math.min(1, t / grand)})` }} />
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-sm tnum">{nf.format(t)}</div>
                          <div className="text-[10px] text-muted-foreground">{((t / grand) * 100).toFixed(1)}%</div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-card-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-5 py-4">
              <History className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-display text-lg">Recent activity</h2>
            </div>
            {activity.isLoading ? (
              <div className="space-y-3 p-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}</div>
            ) : activity.isError ? (
              <div className="p-5 text-sm text-muted-foreground">Activity couldn't be loaded. <button className="text-accent underline" onClick={() => activity.refetch()}>Retry</button></div>
            ) : (activity.data ?? []).length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">No changes recorded yet.</div>
            ) : (
              <ol className="relative px-5 py-4">
                <span className="absolute bottom-6 left-[27px] top-6 w-px bg-border" />
                {(activity.data ?? []).slice(0, 12).map((a) => (
                  <li key={a.id} className="relative flex gap-4 py-2" data-testid={`activity-${a.id}`}>
                    <span className="relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-card bg-accent ring-1 ring-accent/30" />
                    <div className="min-w-0 flex-1 text-sm">
                      <Link href={`/shareholders/${a.shareholderId}`} className="font-medium hover:text-accent">{a.name}</Link>{' '}
                      <span className="text-muted-foreground">{a.action}</span>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{relTime(a.createdAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
