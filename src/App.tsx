import { lazy, Suspense } from 'react';
import { resolveSiteRoute } from './lib/siteRoutes';

export type { PageKey } from './DashboardApp';

const HomePage = lazy(() => import('./pages/HomePage'));
const DashboardApp = lazy(() => import('./DashboardApp'));

export default function App() {
  const route = resolveSiteRoute(window.location.href);
  return <Suspense fallback={<div className="site-loading" role="status">Loading BalikTelaPH...</div>}>
    {route === 'workspace' ? <DashboardApp /> : <HomePage notFound={route === 'not-found'} />}
  </Suspense>;
}
