import {
  BarChart3, ChevronRight, CircleUserRound, ClipboardList, Factory, FileText, Home, LineChart, LogOut,
  MapPinned, Menu, ListChecks, Settings, UserRoundCog, UsersRound, X,
  PackageSearch, Activity, ShieldAlert, Landmark, Building2, History,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { PageKey } from '../App';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { useAuth } from '../context/AuthContext';
import { canAccessPage } from '../access';
import balikTelaLogo from '../assets/auth/baliktelaph.png';
import { useContentTransition } from '../lib/motion';

const navigation: Array<{ key: PageKey; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; section: 'Workspace' | 'Manage' }> = [
  { key: 'overview', label: 'Overview', icon: Home, section: 'Workspace' },
  { key: 'listings', label: 'Listing Oversight', icon: ListChecks, section: 'Workspace' },
  { key: 'materials', label: 'Material Registry', icon: PackageSearch, section: 'Workspace' },
  { key: 'transactions', label: 'Traceability', icon: ClipboardList, section: 'Workspace' },
  { key: 'operations', label: 'Recovery Monitoring', icon: Activity, section: 'Workspace' },
  { key: 'waste', label: 'Waste Analytics', icon: BarChart3, section: 'Workspace' },
  { key: 'stakeholders', label: 'Stakeholders', icon: UsersRound, section: 'Workspace' },
  { key: 'facilities', label: 'Facility Analytics', icon: Factory, section: 'Workspace' },
  { key: 'geographic', label: 'Geographic Insights', icon: MapPinned, section: 'Workspace' },
  { key: 'advanced', label: 'Advanced Analytics', icon: LineChart, section: 'Workspace' },
  { key: 'quality', label: 'Data Quality', icon: ShieldAlert, section: 'Manage' },
  { key: 'governance', label: 'Governance & Policy', icon: Landmark, section: 'Manage' },
  { key: 'reports', label: 'Reports', icon: FileText, section: 'Manage' },
  { key: 'organizations', label: 'Organizations', icon: Building2, section: 'Manage' },
  { key: 'users', label: 'User Accounts', icon: UserRoundCog, section: 'Manage' },
  { key: 'audit', label: 'Audit Trail', icon: History, section: 'Manage' },
  { key: 'profile', label: 'My Profile', icon: CircleUserRound, section: 'Manage' },
  { key: 'settings', label: 'Configuration', icon: Settings, section: 'Manage' },
];

const pageMeta: Record<PageKey, { title: string; description: string }> = {
  overview: { title: 'Overview', description: 'Textile recovery and circular economy performance' },
  listings: { title: 'Listing Oversight', description: 'Monitor mobile-originated material listings and availability' },
  materials: { title: 'Material Registry', description: 'Batch provenance, measurements, custody, and pathway' },
  operations: { title: 'Recovery Monitoring', description: 'Collection, sorting, processing, and recovery outcomes' },
  waste: { title: 'Waste Analytics', description: 'Monitor waste streams, recovery rates, and category mix' },
  transactions: { title: 'Transactions', description: 'Trace textile movement through the circular network' },
  stakeholders: { title: 'Stakeholders', description: 'Participation and performance across the ecosystem' },
  facilities: { title: 'Facilities & Hubs', description: 'Facility performance, Hub approvals, and weighing coverage' },
  geographic: { title: 'Geographic Insights', description: 'Regional activity and collection coverage' },
  advanced: { title: 'Advanced Analytics', description: 'Diagnostic and predictive views' },
  quality: { title: 'Data Quality', description: 'Validation coverage, discrepancies, and integrity findings' },
  governance: { title: 'Governance & Policy', description: 'Methodology, privacy, policy readiness, and constraints' },
  reports: { title: 'Reports', description: 'Exportable summaries for program stakeholders' },
  users: { title: 'User Accounts', description: 'Role, consent, verification, and profile oversight' },
  organizations: { title: 'Organizations', description: 'Organization and facility verification and capability' },
  audit: { title: 'Audit Trail', description: 'Sensitive changes, exports, and lifecycle actions' },
  profile: { title: 'My Profile', description: 'Institutional identity, organization scope, consent, and verification' },
  settings: { title: 'Settings', description: 'Governance, privacy, and data source controls' },
};

export function Layout({ activePage, onPageChange, children, dataContextLabel = 'Platform data · Asia/Manila' }: { activePage: PageKey; onPageChange: (page: PageKey) => void; children: ReactNode; dataContextLabel?: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, access, logout, storageMode } = useAuth();
  const meta = pageMeta[activePage];
  const heading = useContentTransition(activePage);
  const navigate = (page: PageKey) => { onPageChange(page); setMobileOpen(false); };
  const availableNavigation = navigation.filter((item) => canAccessPage(access, item.key) && !(user?.scope.aggregateOnly && ['listings', 'materials', 'operations'].includes(item.key)));

  return (
    <div className="min-h-screen overflow-x-clip bg-[#f5f7f6] text-foreground">
      {mobileOpen ? <button className="overlay-enter fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm xl:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" /> : null}
      <aside className={cn('fixed inset-y-0 left-0 z-50 flex w-[min(15rem,calc(100vw-2.5rem))] -translate-x-full flex-col border-r border-[#dfe5e2] bg-[#fbfcfb] transition-transform duration-200 xl:w-60 xl:translate-x-0', mobileOpen && 'translate-x-0')}>
        <div className="flex h-[104px] shrink-0 items-center justify-center gap-3 border-b border-[#e8ecea] px-5">
          <button type="button" onClick={() => navigate('overview')} aria-label="BalikTelaPH overview" className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"><img src={balikTelaLogo} alt="BalikTelaPH" width={1254} height={1254} className="h-[88px] w-[88px] object-contain" /></button>
          <Button variant="ghost" size="icon" className="ml-auto xl:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></Button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-6">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase text-[#8b9893]">Workspace</p>
          <nav className="space-y-1">{availableNavigation.filter((item) => item.section === 'Workspace').map((item) => <NavItem key={item.key} item={item} active={activePage === item.key} onClick={() => navigate(item.key)} />)}</nav>
          <p className="mb-2 mt-7 px-3 text-[10px] font-semibold uppercase text-[#8b9893]">Manage</p>
          <nav className="space-y-1">{availableNavigation.filter((item) => item.section === 'Manage').map((item) => <NavItem key={item.key} item={item} active={activePage === item.key} onClick={() => navigate(item.key)} />)}</nav>
        </div>
        <div className="border-t border-[#e8ecea] p-3">
          <button type="button" onClick={() => navigate('profile')} className="surface-panel-interactive flex w-full items-center gap-3 rounded-md border border-transparent p-3 text-left">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#dcece6] text-xs font-semibold text-[#205b48]">{initials(user?.fullName ?? 'BT')}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-[#34423d]">{user?.fullName}</p><p className="truncate text-[11px] text-[#718079]">{user?.role} · {storageMode === 'supabase' ? 'Supabase' : storageMode === 'mongodb' ? 'Legacy MongoDB' : 'Demo store'}</p></div>
            <ChevronRight size={15} className="text-[#8b9893]" />
          </button>
        </div>
      </aside>
      <div className="min-w-0 xl:pl-60">
        <header className="sticky top-0 z-30 border-b border-[#dfe5e2] bg-white/95 backdrop-blur-xl">
          <div className="flex min-h-[64px] items-center gap-2 px-3 sm:min-h-[72px] sm:gap-3 sm:px-6 xl:px-8 2xl:px-10">
            <Button variant="ghost" size="icon" className="shrink-0 xl:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></Button>
            <div ref={heading} className="min-w-0 flex-1"><h1 className="truncate text-[17px] font-semibold text-[#17201d]">{meta.title}</h1><p className="hidden truncate text-xs text-[#718079] sm:block">{meta.description}</p></div>
            <div className="hidden items-center gap-2 rounded-md border border-[#dfe5e2] bg-[#f7f9f8] px-2.5 py-1.5 text-[11px] font-medium text-[#66736e] 2xl:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />{dataContextLabel}</div>
            <div className="hidden h-6 w-px bg-slate-200 sm:block" /><button type="button" onClick={() => navigate('profile')} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white" aria-label="Open my profile">{initials(user?.fullName ?? 'BT')}</button>
            <Button variant="ghost" size="icon" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={17} /></Button>
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-[2304px] px-3 py-4 sm:px-6 sm:py-7 xl:px-8 2xl:px-10">
          {children}
          <footer className="mt-8 border-t border-slate-200 py-5 text-center text-xs text-slate-500">PoC workspace · Weights are metric tons (t); 1 t = 1,000 kg.</footer>
        </main>
      </div>
    </div>
  );
}

function initials(name: string) { return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase(); }

function NavItem({ item, active, onClick }: { item: (typeof navigation)[number]; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return <button type="button" onClick={onClick} className={cn('group relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors', active ? 'bg-[#edf4f1] text-[#174b3a]' : 'text-[#53615c] hover:bg-[#f1f4f2] hover:text-[#17201d]')}><span className={cn('absolute inset-y-2 left-0 w-0.5 rounded-full transition-colors', active && 'bg-[#27775c]')} /><Icon size={17} className={cn('shrink-0', active ? 'text-[#27775c]' : 'text-[#8b9893] group-hover:text-[#53615c]')} /><span className="truncate">{item.label}</span>{active ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#27775c]" /> : null}</button>;
}
