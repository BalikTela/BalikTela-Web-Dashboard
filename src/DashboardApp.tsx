import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { FilterBar, initialFilters } from './components/FilterBar';
import { Layout } from './components/Layout';
import { ErrorBlock, LoadingBlock } from './components/StateBlock';
import { useDashboardData } from './hooks/useDashboardData';
import { AuthPage } from './pages/AuthPage';
import { useAuth } from './context/AuthContext';
import { Button } from './components/ui/button';
import { LoaderCircle, ShieldX } from 'lucide-react';
import type { Filters } from './types';
import { canAccessPage } from './access';
import { readAuthLink } from './lib/authLinks';
import { AuthLayout } from './components/AuthLayout';
import { MotionPage } from './lib/motion';
import { AuthProvider } from './context/AuthContext';
import { PageActivity } from './hooks/PageActivity';

export type PageKey = 'overview' | 'listings' | 'materials' | 'operations' | 'waste' | 'transactions' | 'stakeholders' | 'facilities' | 'geographic' | 'advanced' | 'quality' | 'governance' | 'reports' | 'organizations' | 'users' | 'audit' | 'profile' | 'settings';

const dataPages = new Set<PageKey>(['overview', 'waste', 'transactions', 'stakeholders', 'facilities', 'geographic', 'advanced']);
const filterablePages = new Set<PageKey>([...dataPages, 'materials', 'operations', 'quality', 'reports']);
const pageModules = {
  overview: () => import('./pages/Overview'), listings: () => import('./pages/ListingOversight'), materials: () => import('./pages/MaterialRegistry'),
  traceability: () => import('./pages/TraceabilityWorkspace'), operations: () => import('./pages/RecoveryOperations'), waste: () => import('./pages/WasteAnalytics'),
  transactions: () => import('./pages/Transactions'), stakeholders: () => import('./pages/Stakeholders'), facilities: () => import('./pages/Facilities'),
  geographic: () => import('./pages/Geographic'), advanced: () => import('./pages/AdvancedAnalytics'), quality: () => import('./pages/DataQuality'),
  governance: () => import('./pages/Governance'), reports: () => import('./pages/Reports'), organizations: () => import('./pages/OrganizationAdmin'),
  users: () => import('./pages/UserAccounts'), audit: () => import('./pages/AuditTrail'), profile: () => import('./pages/UserProfile'), settings: () => import('./pages/Settings'),
};
const Overview = lazy(() => pageModules.overview().then((module) => ({ default: module.Overview })));
const ListingOversight = lazy(() => pageModules.listings().then((module) => ({ default: module.ListingOversight })));
const MaterialRegistry = lazy(() => pageModules.materials().then((module) => ({ default: module.MaterialRegistry })));
const TraceabilityWorkspace = lazy(() => pageModules.traceability().then((module) => ({ default: module.TraceabilityWorkspace })));
const RecoveryOperations = lazy(() => pageModules.operations().then((module) => ({ default: module.RecoveryOperations })));
const WasteAnalytics = lazy(() => pageModules.waste().then((module) => ({ default: module.WasteAnalytics })));
const Stakeholders = lazy(() => pageModules.stakeholders().then((module) => ({ default: module.Stakeholders })));
const Facilities = lazy(() => pageModules.facilities().then((module) => ({ default: module.Facilities })));
const Geographic = lazy(() => pageModules.geographic().then((module) => ({ default: module.Geographic })));
const AdvancedAnalytics = lazy(() => pageModules.advanced().then((module) => ({ default: module.AdvancedAnalytics })));
const DataQuality = lazy(() => pageModules.quality().then((module) => ({ default: module.DataQuality })));
const Governance = lazy(() => pageModules.governance().then((module) => ({ default: module.Governance })));
const Reports = lazy(() => pageModules.reports().then((module) => ({ default: module.Reports })));
const OrganizationAdmin = lazy(() => pageModules.organizations().then((module) => ({ default: module.OrganizationAdmin })));
const UserAccounts = lazy(() => pageModules.users().then((module) => ({ default: module.UserAccounts })));
const AuditTrail = lazy(() => pageModules.audit().then((module) => ({ default: module.AuditTrail })));
const UserProfile = lazy(() => pageModules.profile().then((module) => ({ default: module.UserProfile })));
const Settings = lazy(() => pageModules.settings().then((module) => ({ default: module.Settings })));

function App() {
  const { user, access, isLoading: authLoading } = useAuth();
  const [emailCallback, setEmailCallback] = useState(() => readAuthLink(window.location.href).isCallback);

  useEffect(() => {
    document.title = 'Web Dashboard | BalikTelaPH';
    if (user && !emailCallback && window.location.pathname !== '/dashboard') window.history.replaceState({}, '', '/dashboard');
    if (!user && !authLoading && !emailCallback && window.location.pathname !== '/login') window.history.replaceState({}, '', '/login');
  }, [user, emailCallback, authLoading]);

  if (emailCallback) return <AuthPage onAuthenticated={() => setEmailCallback(false)} />;

  if (authLoading) return <AuthLayout><div className="auth-session-status" role="status"><LoaderCircle size={20} className="animate-spin" aria-hidden="true" />Restoring secure session…</div></AuthLayout>;
  if (!user) return <AuthPage />;

  const isDashboardUser = access?.permissions.includes('analytics.read');
  return isDashboardUser ? <DashboardWorkspace /> : <DashboardAccessBoundary />;
}

function DashboardWorkspace() {
  const { user, access } = useAuth();
  const [activePage, setActivePage] = useState<PageKey>('overview');
  const [visitedPages, setVisitedPages] = useState<Set<PageKey>>(() => new Set(['overview']));
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [advancedMode, setAdvancedMode] = useState('Diagnostic');
  const restricted = !canAccessPage(access, activePage) || Boolean(user?.scope.aggregateOnly && ['listings', 'materials', 'operations'].includes(activePage));
  const currentPage: PageKey = restricted ? 'overview' : activePage;
  const dashboardScopeKey = useMemo(() => JSON.stringify({ id: user?.id, role: user?.role, organizationId: user?.organizationId, scope: user?.scope }), [user]);
  const needsDashboardData = dataPages.has(currentPage);
  const { data, isLoading, isRefreshing, error } = useDashboardData(filters, dashboardScopeKey, needsDashboardData);

  useEffect(() => {
    if (restricted) setActivePage('overview');
  }, [activePage, restricted]);

  useEffect(() => {
    const preload = () => { void Promise.allSettled(Object.values(pageModules).map((load) => load())); };
    if ('requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 4_000 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timer = globalThis.setTimeout(preload, 1_500);
    return () => globalThis.clearTimeout(timer);
  }, []);

  const openPage = (page: PageKey) => {
    setVisitedPages((current) => current.has(page) ? current : new Set(current).add(page));
    setActivePage(page);
  };

  const pageContent = (page: PageKey) => {
    if (page === 'overview' && data) return <Overview data={data} />;
    if (page === 'listings') return <ListingOversight />;
    if (page === 'materials') return <MaterialRegistry filters={filters} />;
    if (page === 'operations') return <RecoveryOperations filters={filters} />;
    if (page === 'waste' && data) return <WasteAnalytics data={data} />;
    if (page === 'transactions' && data) return <TraceabilityWorkspace data={data} filters={filters} />;
    if (page === 'stakeholders' && data) return <Stakeholders data={data} />;
    if (page === 'facilities' && data) return <Facilities data={data} filters={filters} />;
    if (page === 'geographic' && data) return <Geographic data={data} />;
    if (page === 'advanced' && data) return <AdvancedAnalytics data={data} onModeChange={setAdvancedMode} />;
    if (page === 'quality') return <DataQuality filters={filters} />;
    if (page === 'governance') return <Governance />;
    if (page === 'reports') return <Reports filters={filters} active={currentPage === 'reports'} />;
    if (page === 'organizations') return <OrganizationAdmin />;
    if (page === 'users') return <UserAccounts />;
    if (page === 'audit') return <AuditTrail />;
    if (page === 'profile') return <UserProfile />;
    if (page === 'settings') return <Settings />;
    return null;
  };

  return (
    <Layout activePage={currentPage} onPageChange={openPage} dataContextLabel={currentPage === 'advanced' && advancedMode === 'Predictive' ? 'Synthetic PoC · Fixed snapshot' : undefined}>
      <div className="space-y-6">
        {filterablePages.has(currentPage) && (currentPage !== 'advanced' || advancedMode === 'Diagnostic') ? <FilterBar filters={filters} onChange={setFilters} /> : null}
        {needsDashboardData && isRefreshing && data ? <p className="flex items-center gap-2 text-xs text-[#66736e]" role="status"><LoaderCircle size={14} className="animate-spin" />Refreshing analytics…</p> : null}
        {needsDashboardData && isLoading && !data ? <LoadingBlock /> : null}
        {needsDashboardData && error && !data ? <ErrorBlock message={error} /> : null}
        {needsDashboardData && error && data ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">The latest refresh failed. Showing the most recently loaded analytics.</p> : null}
        {(!needsDashboardData || data) ? (
          <Suspense fallback={<LoadingBlock label="Loading workspace…" />}>
            {[...visitedPages].map((page) => <PageActivity.Provider key={page} value={page === currentPage}><MotionPage active={page === currentPage}>{pageContent(page)}</MotionPage></PageActivity.Provider>)}
          </Suspense>
        ) : null}
      </div>
    </Layout>
  );
}

function DashboardAccessBoundary() {
  const { user, logout } = useAuth();
  const pending = user?.accountStatus === 'Pending verification' || user?.role === 'BalikTela Hub' && !user.organizationVerified;
  return <AuthLayout><section className="auth-form auth-boundary"><ShieldX size={24} className="text-amber-700" aria-hidden="true" /><h1 className="auth-title mt-5">{pending ? 'Account approval is pending' : 'Dashboard access is not assigned to this role'}</h1><p className="auth-description">{pending ? `${user?.fullName}, your email and password are registered. A system administrator must verify your organization and approve your institutional access.` : `${user?.fullName}, participant exchange, communication, rewards, and engagement activity belongs to the BalikTela mobile application. This web dashboard is reserved for authorized management, monitoring, analytics, governance, and research roles.`}</p><Button className="mt-7 w-full" variant="outline" onClick={logout}>Sign out</Button></section></AuthLayout>;
}

export default function DashboardApp() { return <AuthProvider><App /></AuthProvider>; }
