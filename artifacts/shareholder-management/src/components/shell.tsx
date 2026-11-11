import { type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';
import { ArrowLeftRight, FileBadge2, FileSignature, FileSpreadsheet, LayoutDashboard, LogOut, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const NAV = [
  { href: '/home', label: 'Home', icon: LayoutDashboard },
  { href: '/shareholders', label: 'Shareholders', icon: Users },
  { href: '/certificates', label: 'Certificates', icon: FileBadge2 },
  { href: '/transfers', label: 'Transfer History', icon: ArrowLeftRight },
  { href: '/reports', label: 'Reports', icon: FileSpreadsheet },
  { href: '/sign-off-requests', label: 'Pending Sign Off Requests', icon: FileSignature },
];

export function Brand({ light = true }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img
        src={`${basePath}/tinius-olsen-logo.png`}
        alt="Tinius Olsen"
        className="h-9 w-9 rounded-md bg-white p-0.5 object-contain shadow-sm"
      />
      <div className="leading-tight">
        <div className={cn('font-display text-[17px]', light ? 'text-sidebar-accent-foreground' : 'text-foreground')}>
          Shareholder
        </div>
        <div className={cn('text-[10px] uppercase tracking-[0.22em]', light ? 'text-sidebar-foreground/60' : 'text-muted-foreground')}>
          Management
        </div>
      </div>
    </div>
  );
}

export function SidebarNav({ preview = false }: { preview?: boolean }) {
  const [loc] = useLocation();
  return (
    <nav className="flex flex-col gap-0.5">
      <div className="px-3 pb-2 text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/50">Registry</div>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = !preview && (loc === href || loc.startsWith(href + '/') || (href === '/sign-off-requests' && loc.startsWith('/transfer-requests')));
        const cls = cn(
          'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
        );
        const inner = (
          <>
            <span className={cn('absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-sidebar-primary transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
            <Icon className="h-4 w-4" />
            {label}
          </>
        );
        return preview ? (
          <div key={href} className={cls}>{inner}</div>
        ) : (
          <Link key={href} href={href} className={cls} data-testid={`link-nav-${label.toLowerCase().replace(/ /g, '-')}`}>{inner}</Link>
        );
      })}
    </nav>
  );
}

function useHasPilotAccess() {
  return useAuth().isAuthenticated;
}

function SettingsLink() {
  const [loc] = useLocation();
  if (!useHasPilotAccess()) return null;
  const active = loc === '/settings';
  return (
    <div className="px-3 pb-3">
      <Link href="/settings" data-testid="link-nav-settings"
        className={cn('relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors', active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground')}>
        <span className={cn('absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-sidebar-primary transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
        <Settings className="h-4 w-4" />Settings
      </Link>
    </div>
  );
}

function UserFooter() {
  const { user, logout } = useAuth();
  const email = user?.email ?? '';
  return (
    <div className="flex items-center gap-2 border-t border-sidebar-border px-3 pt-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
        {(user?.firstName?.[0] ?? email[0] ?? '?').toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-sidebar-accent-foreground" data-testid="user-name-display">{[user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Pilot participant'}</div>
        <div className="truncate text-[11px] text-sidebar-foreground/60" data-testid="user-email-display">{email}</div>
      </div>
      <button
        type="button"
        onClick={logout}
        className="rounded-md p-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        title="Sign out"
        data-testid="button-sign-out"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const hasAccess = useHasPilotAccess();
  const { logout } = useAuth();
  const mobileNav = hasAccess ? [...NAV, { href: '/settings', label: 'Settings', icon: Settings }] : NAV;
  return (
    <div className="flex min-h-[100dvh] flex-col md:flex-row">
      <aside className="sticky top-0 hidden h-[100dvh] w-64 shrink-0 flex-col justify-between bg-sidebar py-5 md:flex">
        <div className="space-y-8 px-3">
          <div className="px-2"><Brand /></div>
          <SidebarNav />
        </div>
        <div><SettingsLink /><UserFooter /></div>
      </aside>
      <header className="flex items-center justify-between gap-3 bg-sidebar px-4 py-3 md:hidden">
        <Brand />
        <div className="flex flex-wrap justify-end gap-1">
          {mobileNav.map((n) => (
            <Link key={n.href} href={n.href} data-testid={`link-mobile-${n.label.toLowerCase().replace(/ /g, '-')}`} className={cn('rounded px-2.5 py-1.5 text-xs', loc.startsWith(n.href) ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/80')}>
              {n.label}
            </Link>
          ))}
          <button onClick={logout} className="rounded px-2.5 py-1.5 text-xs text-sidebar-foreground" data-testid="button-mobile-sign-out">Log out</button>
        </div>
      </header>
      <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
    </div>
  );
}

export function PageHeader({ eyebrow, title, actions }: { eyebrow?: string; title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-6 pb-5 pt-8 md:px-10">
      <div>
        {eyebrow && <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-accent">{eyebrow}</div>}
        <h1 className="font-display text-3xl text-foreground md:text-[34px]">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
