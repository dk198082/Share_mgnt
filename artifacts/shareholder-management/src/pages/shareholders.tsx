import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useListShareholders } from '@workspace/api-client-react';
import { FileText, Plus, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/shell';
import { fileUrl, fmtDate, initials, nf, totalShares } from '@/lib/format';

const ALL = '__all';

export default function Shareholders() {
  const [, setLocation] = useLocation();
  const { data, isLoading, isError, refetch } = useListShareholders();
  const [q, setQ] = useState('');
  const [line, setLine] = useState(ALL);
  const [gen, setGen] = useState(ALL);
  const [cls, setCls] = useState(ALL);
  const [status, setStatus] = useState(ALL);

  const rows = data ?? [];
  const opts = useMemo(() => {
    const lines = new Set<string>(), gens = new Set<string>(), classes = new Set<string>();
    (data ?? []).forEach((s) => {
      if (s.familyLine) lines.add(s.familyLine);
      if (s.generationNumber) gens.add(s.generationNumber);
      s.shares.forEach((h) => h.shareClass && classes.add(h.shareClass));
    });
    return { lines: [...lines].sort(), gens: [...gens].sort(), classes: [...classes].sort() };
  }, [data]);

  const filtered = rows.filter((s) => {
    const t = q.trim().toLowerCase();
    if (t && ![s.name, s.email, s.familyLine, s.generationNumber, ...s.shares.map((h) => h.certificateNumber ?? '')].some((v) => v?.toLowerCase().includes(t))) return false;
    if (line !== ALL && s.familyLine !== line) return false;
    if (gen !== ALL && s.generationNumber !== gen) return false;
    if (cls !== ALL && !s.shares.some((h) => h.shareClass === cls)) return false;
    if (status === 'living' && s.dateOfPassing) return false;
    if (status === 'deceased' && !s.dateOfPassing) return false;
    return true;
  });
  const active = q || line !== ALL || gen !== ALL || cls !== ALL || status !== ALL;
  const filteredTotal = filtered.reduce((a, s) => a + totalShares(s.shares), 0);
  const clear = () => { setQ(''); setLine(ALL); setGen(ALL); setCls(ALL); setStatus(ALL); };

  return (
    <div>
      <PageHeader
        eyebrow="Registry report"
        title="Shareholders"
        actions={<Link href="/shareholders/new" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90" data-testid="link-create-shareholder"><Plus className="h-4 w-4" /> New shareholder</Link>}
      />
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-border bg-background/90 px-6 py-3 backdrop-blur md:px-10">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, line, certificate" className="bg-card pl-9" data-testid="input-search" />
        </div>
        <FilterSelect value={line} onChange={setLine} label="All family lines" options={opts.lines} testId="select-family-line" />
        <FilterSelect value={gen} onChange={setGen} label="All generations" options={opts.gens} testId="select-generation" />
        <FilterSelect value={cls} onChange={setCls} label="All share classes" options={opts.classes} testId="select-class" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36 bg-card" data-testid="select-status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any status</SelectItem>
            <SelectItem value="living">Living</SelectItem>
            <SelectItem value="deceased">Deceased</SelectItem>
          </SelectContent>
        </Select>
        {active && <Button variant="ghost" size="sm" onClick={clear} data-testid="button-clear-filters"><X className="mr-1 h-3.5 w-3.5" />Clear</Button>}
        <div className="ml-auto text-xs text-muted-foreground tnum" data-testid="text-result-count">
          {filtered.length} of {rows.length} · {nf.format(filteredTotal)} shares
        </div>
      </div>

      <div className="px-6 py-6 md:px-10">
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
            <div className="font-display text-lg">The registry couldn't be loaded.</div>
            <Button className="mt-4" variant="outline" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="ruled rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
            <div className="font-display text-2xl">No shareholders on file.</div>
            <p className="mt-2 text-sm text-muted-foreground">Start the registry with the first person who holds shares.</p>
            <Link href="/shareholders/new" className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"><Plus className="h-4 w-4" />Create shareholder</Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-12 text-center">
            <div className="font-display text-lg">Nothing matches those filters.</div>
            <Button className="mt-3" variant="outline" size="sm" onClick={clear}>Clear filters</Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-card-border bg-card">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Shareholder</th>
                  <th className="px-4 py-3 font-medium">Family line</th>
                  <th className="px-4 py-3 font-medium">Gen.</th>
                  <th className="px-4 py-3 font-medium">Classes</th>
                  <th className="px-4 py-3 text-right font-medium">Shares</th>
                  <th className="px-4 py-3 text-center font-medium">Docs</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setLocation(`/shareholders/${s.id}`)}
                    className="group cursor-pointer transition-colors hover:bg-secondary/50"
                    data-testid={`row-shareholder-${s.id}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {s.picturePath ? (
                          <img src={fileUrl(s.picturePath)} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-border" />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials(s.name)}</div>
                        )}
                        <div className="min-w-0">
                          <Link href={`/shareholders/${s.id}`} onClick={(e) => e.stopPropagation()} className="font-medium group-hover:text-accent" data-testid={`link-open-${s.id}`}>{s.name}</Link>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="truncate">{s.email || 'No email'}</span>
                            {s.dateOfPassing && <span className="rounded-sm bg-secondary px-1.5 text-[10px] uppercase tracking-wide">d. {fmtDate(s.dateOfPassing)}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{s.familyLine || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 font-mono text-xs">{s.generationNumber || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {[...new Set(s.shares.map((h) => h.shareClass))].map((c) => (
                          <span key={c} className="rounded-sm border border-border px-1.5 py-px text-[11px]">{c}</span>
                        ))}
                        {s.shares.length === 0 && <span className="text-muted-foreground">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tnum">{nf.format(totalShares(s.shares))}</td>
                    <td className="px-4 py-3 text-center">
                      {s.documents.length ? <span className="inline-flex items-center gap-1 text-xs"><FileText className="h-3.5 w-3.5 text-muted-foreground" />{s.documents.length}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(s.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, label, options, testId }: { value: string; onChange: (v: string) => void; label: string; options: string[]; testId: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44 bg-card" data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
