import { Link } from 'wouter';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Brand, SidebarNav } from '@/components/shell';

export default function Landing() {
  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Brand light={false} />
      </header>

      <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-16 pt-10 lg:grid-cols-[1fr_1.15fr] lg:items-center">
        <div className="rise">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-accent" /> Internal · Company employees
          </div>
          <h1 className="font-display text-[44px] leading-[1.05] text-foreground md:text-6xl">
            The family's ownership,<br />
            <em className="text-accent">kept with care.</em>
          </h1>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-in" className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm text-primary-foreground hover:bg-primary/90" data-testid="link-hero-sign-in">
              Sign in with Microsoft <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>

        <div className="rise relative" style={{ animationDelay: '120ms' }} aria-label="Product preview without data">
          <div className="absolute -inset-4 -z-10 rotate-[-1.5deg] rounded-2xl bg-accent/10" />
          <div className="flex overflow-hidden rounded-xl border border-card-border bg-card shadow-[0_30px_60px_-30px_hsl(192_45%_18%/.5)]">
            <div className="hidden w-52 shrink-0 space-y-6 bg-sidebar p-4 sm:block">
              <Brand />
              <SidebarNav preview />
            </div>
            <div className="flex-1 p-5">
              <div className="text-[10px] uppercase tracking-[0.2em] text-accent">Registry</div>
              <div className="font-display text-xl">Shareholders</div>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {['People', 'Shares', 'Lines', 'Files'].map((l) => (
                  <div key={l} className="rounded-md border border-border p-2">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{l}</div>
                    <div className="mt-1.5 h-3 w-8 rounded bg-secondary" />
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3 rounded-md border border-border/70 px-3 py-2">
                    <div className="h-6 w-6 rounded-full bg-secondary" />
                    <div className="h-2.5 rounded bg-secondary" style={{ width: `${30 + ((i * 17) % 30)}%` }} />
                    <div className="ml-auto h-2.5 w-10 rounded bg-primary/15" />
                  </div>
                ))}
              </div>
              <div className="mt-3 text-center text-[10px] text-muted-foreground">Records appear only after employee sign-in.</div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">Shareholder Management · Internal use only</footer>
    </div>
  );
}
