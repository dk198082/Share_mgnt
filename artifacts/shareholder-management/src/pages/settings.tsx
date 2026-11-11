import { useState } from 'react';
import { BadgeDollarSign, PenLine, History, FileText, Database } from 'lucide-react';
import { PageHeader } from '@/components/shell';
import { cn } from '@/lib/utils';
import { SharePricesPanel } from '@/components/settings/share-prices';
import { SignoffsPanel } from '@/components/settings/signoffs';
import { SettingsAuditPanel } from '@/components/settings/audit-log';
import { CertificateTemplatesPanel } from '@/components/settings/certificate-templates';
import { PilotDataPanel } from '@/components/settings/pilot-data';

const TABS = [
  { id: 'prices', label: 'Share prices', icon: BadgeDollarSign },
  { id: 'signoffs', label: 'Sign-offs', icon: PenLine },
  { id: 'certificates', label: 'Certificate templates', icon: FileText },
  { id: 'audit', label: 'Audit log', icon: History },
  { id: 'pilot', label: 'Pilot data', icon: Database },
] as const;
type TabId = typeof TABS[number]['id'];

export default function Settings() {
  const [tab, setTab] = useState<TabId>('prices');

  return (
    <div className="pb-16">
      <PageHeader eyebrow="Pilot configuration" title="Settings" />
      <p className="px-6 pt-5 text-sm text-muted-foreground md:px-10">Microsoft Entra signs users in. Any authenticated account in the configured tenant has the same app access; named approval rights still follow Settings → Sign-offs. Replit private publishing may apply an additional access gate.</p>
      <div className="border-b border-border px-6 md:px-10">
        <div role="tablist" aria-label="Settings sections" className="-mb-px flex gap-6 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} id={`tab-${id}`} role="tab" type="button" aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)}
              className={cn('flex shrink-0 items-center gap-2 border-b-2 py-3 text-sm transition-colors', tab === id ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
              data-testid={`tab-settings-${id}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
      </div>
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="rise px-6 py-8 md:px-10" key={tab}>
        {tab === 'prices' ? <SharePricesPanel /> : tab === 'signoffs' ? <SignoffsPanel /> : tab === 'certificates' ? <CertificateTemplatesPanel /> : tab === 'audit' ? <SettingsAuditPanel /> : <PilotDataPanel />}
      </div>
    </div>
  );
}
