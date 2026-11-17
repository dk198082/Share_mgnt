import { useState } from 'react';
import { useSearch, useLocation } from 'wouter';
import { BadgeDollarSign, PenLine, History, FileText, FileUp, Users } from 'lucide-react';
import { PageHeader } from '@/components/shell';
import { cn } from '@/lib/utils';
import { SharePricesPanel } from '@/components/settings/share-prices';
import { SignoffsPanel } from '@/components/settings/signoffs';
import { SettingsAuditPanel } from '@/components/settings/audit-log';
import { DataImportPanel } from '@/components/settings/data-import';
import { CertificateTemplatesPanel } from '@/components/settings/certificate-templates';
import { UserDirectoryPanel } from '@/components/settings/user-directory';

const TABS = [
  { id: 'users', n: '01', label: 'Users', icon: Users },
  { id: 'signoffs', n: '02', label: 'Sign-offs', icon: PenLine },
  { id: 'prices', n: '03', label: 'Share prices', icon: BadgeDollarSign },
  { id: 'certificates', n: '04', label: 'Certificate templates', icon: FileText },
  { id: 'audit', n: '05', label: 'Audit log', icon: History },
  { id: 'import', n: '06', label: 'Data import', icon: FileUp },
] as const;
type TabId = typeof TABS[number]['id'];

export default function Settings() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const initial = new URLSearchParams(search).get('tab');
  const [tab, setTabState] = useState<TabId>(TABS.some((t) => t.id === initial) ? (initial as TabId) : 'prices');
  const setTab = (id: TabId) => { setTabState(id); navigate(`${location}?tab=${id}`, { replace: true }); };

  return (
    <div className="pb-16">
      <PageHeader eyebrow="Pilot configuration" title="Settings" />
      <div className="border-b border-border px-6 md:px-10">
        <div role="tablist" aria-label="Settings sections" className="-mb-px flex gap-6 overflow-x-auto">
          {TABS.map(({ id, n, label, icon: Icon }) => (
            <button key={id} id={`tab-${id}`} role="tab" type="button" aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)}
              className={cn('flex shrink-0 items-center gap-2 border-b-2 py-3 text-sm transition-colors', tab === id ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
              data-testid={`tab-settings-${id}`}>
              <Icon className="h-4 w-4" /><span className="font-mono text-[11px] text-accent">{n}</span>{label}
            </button>
          ))}
        </div>
      </div>
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="rise px-6 py-8 md:px-10" key={tab}>
        {tab === 'users' ? <UserDirectoryPanel /> : tab === 'prices' ? <SharePricesPanel /> : tab === 'signoffs' ? <SignoffsPanel /> : tab === 'certificates' ? <CertificateTemplatesPanel /> : tab === 'import' ? <DataImportPanel /> : <SettingsAuditPanel />}
      </div>
    </div>
  );
}
