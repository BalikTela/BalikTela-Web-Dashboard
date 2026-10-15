import {
  Bell, ChevronRight, CircleUserRound, ClipboardList, Coins, Home, Inbox, LayoutGrid,
  LogOut, Menu, MessageSquare, PackageOpen, Recycle, Store, X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';

export type ParticipantPageKey = 'home' | 'marketplace' | 'inventory' | 'activity' | 'messages' | 'wallet' | 'impact' | 'profile';

const navigation: Array<{ key: ParticipantPageKey; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'marketplace', label: 'Marketplace', icon: Store },
  { key: 'inventory', label: 'My materials', icon: PackageOpen },
  { key: 'activity', label: 'Offers & activity', icon: ClipboardList },
  { key: 'messages', label: 'Messages', icon: MessageSquare },
  { key: 'wallet', label: 'Eco-wallet', icon: Coins },
  { key: 'impact', label: 'My impact', icon: Recycle },
  { key: 'profile', label: 'Profile', icon: CircleUserRound },
];

const pageMeta: Record<ParticipantPageKey, { title: string; description: string }> = {
  home: { title: 'Material exchange overview', description: 'Your listings, offers, coordination tasks, and circular activity' },
  marketplace: { title: 'Textile marketplace', description: 'Find available materials and propose an exchange' },
  inventory: { title: 'My materials', description: 'Manage the textile listings associated with your account' },
  activity: { title: 'Offers and activity', description: 'Review incoming and outgoing exchange proposals' },
  messages: { title: 'Messages', description: 'Coordinate collection, validation, and exchange terms' },
  wallet: { title: 'Eco-wallet', description: 'Review demo reward credits and their source activity' },
  impact: { title: 'My circular activity', description: 'Estimated and recorded participation measures for this account' },
  profile: { title: 'Profile', description: 'Maintain participant, organization, and sustainability information' },
};

export function ParticipantLayout({ activePage, onPageChange, children }: { activePage: ParticipantPageKey; onPageChange: (page: ParticipantPageKey) => void; children: ReactNode }) {
  const { user, logout, storageMode } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const meta = pageMeta[activePage];
  const roleLabel = user?.role === 'Producer' ? 'Producer workspace' : 'Beneficiary workspace';
  const navigate = (page: ParticipantPageKey) => { onPageChange(page); setMobileOpen(false); };

  return (
    <div className="min-h-screen bg-[#f3f6f4] text-[#17201d]">
      {mobileOpen ? <button type="button" className="overlay-enter fixed inset-0 z-40 bg-slate-950/30 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" /> : null}
      <aside className={cn('fixed inset-y-0 left-0 z-50 flex w-64 -translate-x-full flex-col border-r border-[#dce4e0] bg-white transition-transform duration-200 lg:translate-x-0', mobileOpen && 'translate-x-0')}>
        <div className="flex h-[72px] items-center gap-3 border-b border-[#e7ece9] px-5">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-[#1c4b3b] text-white"><Recycle size={18} /></span>
          <div className="min-w-0"><p className="text-[15px] font-semibold">BalikTela</p><p className="truncate text-[11px] text-[#718079]">Waste 2 Worth</p></div>
          <Button variant="ghost" size="icon" className="ml-auto lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></Button>
        </div>

        <div className="border-b border-[#e7ece9] px-5 py-4">
          <p className="text-[10px] font-semibold uppercase text-emerald-700">{roleLabel}</p>
          <p className="mt-1 truncate text-sm font-medium">{user?.organization || user?.fullName}</p>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-[#718079]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />{user?.verification}</div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Participant workspace">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase text-[#8b9893]">Exchange</p>
          <div className="space-y-1">{navigation.slice(0, 5).map((item) => <NavItem key={item.key} item={item} active={activePage === item.key} onClick={() => navigate(item.key)} />)}</div>
          <p className="mb-2 mt-7 px-3 text-[10px] font-semibold uppercase text-[#8b9893]">Account</p>
          <div className="space-y-1">{navigation.slice(5).map((item) => <NavItem key={item.key} item={item} active={activePage === item.key} onClick={() => navigate(item.key)} />)}</div>
        </nav>

        <div className="border-t border-[#e7ece9] p-3">
          <button type="button" onClick={() => navigate('profile')} className="surface-panel-interactive flex w-full items-center gap-3 rounded-md p-3 text-left">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#dcece6] text-xs font-semibold text-[#205b48]">{initials(user?.fullName ?? 'BT')}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{user?.fullName}</span><span className="block truncate text-[11px] text-[#718079]">{storageMode === 'supabase' ? 'Supabase connected' : storageMode === 'mongodb' ? 'Legacy database' : 'Demo account'}</span></span>
            <ChevronRight size={15} className="text-[#8b9893]" />
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-[#dce4e0] bg-white/95 backdrop-blur-xl">
          <div className="flex h-[72px] items-center gap-3 px-4 sm:px-6 xl:px-8">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></Button>
            <div className="min-w-0 flex-1"><h1 className="truncate text-[17px] font-semibold">{meta.title}</h1><p className="hidden truncate text-xs text-[#718079] sm:block">{meta.description}</p></div>
            <span className="hidden rounded-md border border-[#dce4e0] bg-[#f7f9f8] px-2.5 py-1.5 text-[11px] font-medium text-[#66736e] sm:block">Sample platform records</span>
            <Button variant="ghost" size="icon" onClick={() => navigate('messages')} aria-label="Open messages"><Inbox size={18} /></Button>
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications"><Bell size={18} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-emerald-600 ring-2 ring-white" /></Button>
            <Button variant="ghost" size="icon" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={17} /></Button>
          </div>
        </header>

        <main className="mx-auto max-w-[1480px] px-4 py-5 pb-24 sm:px-6 sm:py-7 lg:pb-7 xl:px-8">
          {children}
          <footer className="mt-8 border-t border-[#dce4e0] py-5 text-center text-xs text-[#718079]">Sample data for demonstration. Reward and impact figures are not validated real-world outcomes.</footer>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[68px] grid-cols-5 border-t border-[#dce4e0] bg-white px-1 pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Mobile participant navigation">
        <MobileNav page="home" label="Home" icon={Home} active={activePage === 'home'} onClick={navigate} />
        <MobileNav page="marketplace" label="Browse" icon={Store} active={activePage === 'marketplace'} onClick={navigate} />
        <MobileNav page="inventory" label="Materials" icon={PackageOpen} active={activePage === 'inventory'} onClick={navigate} />
        <MobileNav page="activity" label="Activity" icon={ClipboardList} active={activePage === 'activity'} onClick={navigate} />
        <MobileNav page="profile" label="Profile" icon={CircleUserRound} active={activePage === 'profile'} onClick={navigate} />
      </nav>
    </div>
  );
}

function NavItem({ item, active, onClick }: { item: (typeof navigation)[number]; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn('flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm transition-colors', active ? 'bg-[#e6f0eb] font-medium text-[#174b3a]' : 'text-[#53615c] hover:bg-[#f3f6f4]')}><item.icon size={17} /><span>{item.label}</span></button>;
}

function MobileNav({ page, label, icon: Icon, active, onClick }: { page: ParticipantPageKey; label: string; icon: React.ComponentType<{ size?: number }>; active: boolean; onClick: (page: ParticipantPageKey) => void }) {
  return <button type="button" onClick={() => onClick(page)} className={cn('flex min-w-0 flex-col items-center justify-center gap-1 text-[10px]', active ? 'font-medium text-emerald-800' : 'text-[#718079]')}><Icon size={19} /><span className="max-w-full truncate">{label}</span></button>;
}

function initials(name: string) { return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
