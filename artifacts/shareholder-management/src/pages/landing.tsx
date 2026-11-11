import { Link } from 'wouter';
import { ArrowRight, FileLock2, GitBranch, Layers, ShieldCheck, UserRound, Wallet } from 'lucide-react';
import { Brand, SidebarNav } from '@/components/shell';

const SECTIONS = [
  { icon: UserRound, title: 'Shareholder information', body: 'Name, contact, dates of birth and passing, and a secured SSN that is only ever shown masked.' },
  { icon: GitBranch, title: 'Family line', body: 'Each person is placed by family line and generation, so ownership reads as lineage, not a spreadsheet.' },
  { icon: Layers, title: 'Holdings - Shares', body: 'Certificate-backed holdings with issue dates, status, and fully diluted percentages, totalled per person and across the registry.' },
  { icon: Wallet, title: 'Financial notes', body: 'A working notebook for financial context that belongs with the record.' },
  { icon: FileLock2, title: 'Documents', body: 'Drop in PDFs, scans, and letters. Files are stored privately and served only to signed-in staff.' },
];

export default function Landing() {
  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Brand light={false} />
        <div className="flex items-center gap-2">
          <Link href="/sign-in" className="rounded-md px-4 py-2 text-sm text-foreground hover:bg-secondary" data-testid="link-sign-in">Sign in</Link>
        </div>
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
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            One place for the people who hold the company and the shares they hold. Built for the employees who manage both.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-in" className="group inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm text-primary-foreground hover:bg-primary/90" data-testid="link-hero-sign-in">
              Sign in with Microsoft <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
          <p className="mt-6 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Use your company Microsoft account. All signed-in users in the configured tenant have the same app access.
          </p>
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

      <section className="border-y border-border bg-card/60">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-10 md:grid-cols-[0.8fr_2fr]">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-accent">The record</div>
              <h2 className="mt-2 font-display text-3xl">Six sections, one person.</h2>
              <p className="mt-3 text-sm text-muted-foreground">Every shareholder file follows the same order, so anyone on the team can find what they need.</p>
            </div>
            <ol className="divide-y divide-border">
              <li className="flex gap-5 py-4">
                <span className="w-6 font-mono text-xs text-muted-foreground">01</span>
                <div><div className="font-medium">Picture</div><div className="text-sm text-muted-foreground">A portrait so the record has a face.</div></div>
              </li>
              {SECTIONS.map((s, i) => (
                <li key={s.title} className="flex gap-5 py-4">
                  <span className="w-6 font-mono text-xs text-muted-foreground">0{i + 2}</span>
                  <div className="flex gap-3">
                    <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div><div className="font-medium">{s.title}</div><div className="text-sm text-muted-foreground">{s.body}</div></div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-3">
        <div className="md:col-span-2">
          <h3 className="font-display text-2xl">Who can get in</h3>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Private publishing invitations control entry to this pilot. Signed-in participants share the same app access. Transfers and certificate issuance still require the named signers configured in Settings.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 text-sm">
          <div className="font-medium">Need access?</div>
          <p className="mt-1 text-muted-foreground">The published pilot may also require a Replit publishing invitation before Microsoft sign-in.</p>
          <Link href="/sign-in" className="mt-4 inline-flex items-center gap-1 text-accent hover:underline">Log in <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
      </section>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">Shareholder Management · Internal use only</footer>
    </div>
  );
}
