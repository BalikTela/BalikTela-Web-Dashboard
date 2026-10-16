import type { Express, Request, Response } from 'express';
import { authorize } from '../access-control.js';
import { requireAuth, type AuthenticatedRequest } from '../auth.js';
import { AsyncTtlCache, dashboardAnalyticsCacheKey } from '../asyncCache.js';
import type { Store } from '../store.js';
import type { UserRecord } from '../types.js';
import type { PredictiveReport } from '../../shared/predictive.js';
import { buildPredictiveReport, trainingCsv, type PredictiveScope } from './predictive.js';
import { MATERIALS, REGIONS, syntheticDataset } from './synthetic.js';

export function predictiveScope(query: Request['query'], actor: UserRecord): PredictiveScope {
  for (const [key, value] of Object.entries(query)) {
    if (!['region', 'materialCategory', 'historyWeeks'].includes(key) || typeof value !== 'string') throw new Error('Unsupported predictive filter.');
  }
  const region = String(query.region ?? 'All regions');
  const materialCategory = String(query.materialCategory ?? 'All materials');
  const historyWeeks = Number(query.historyWeeks ?? 26);
  if (region !== 'All regions' && !REGIONS.includes(region)) throw new Error('Unknown synthetic region.');
  if (materialCategory !== 'All materials' && !MATERIALS.includes(materialCategory)) throw new Error('Unknown synthetic material.');
  if (![13, 26, 52, 120].includes(historyWeeks)) throw new Error('History must be 13, 26, 52, or 120 weeks.');
  const allowedRegions = actor.role !== 'Administrator' && actor.scope.regions.length ? actor.scope.regions : undefined;
  return { region, materialCategory, historyWeeks, allowedRegions };
}

export function registerPredictiveRoutes(app: Express, store: Store) {
  const cache = new AsyncTtlCache<PredictiveReport>(300_000, 32);
  app.use('/api/analytics/predictive', (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  const handler = (download: boolean) => async (req: AuthenticatedRequest, res: Response) => {
    const actor = req.actor!;
    let scope: PredictiveScope;
    try { scope = predictiveScope(req.query, actor); }
    catch (error) { return res.status(400).json({ message: (error as Error).message }); }
    if (scope.allowedRegions && scope.region !== 'All regions' && !scope.allowedRegions.includes(scope.region!)) {
      return res.status(403).json({ message: 'The requested region is outside your assigned scope.' });
    }
    if (download) {
      const rows = syntheticDataset.observations.filter(row => (scope.region === 'All regions' || row.region === scope.region)
        && (scope.materialCategory === 'All materials' || row.materialCategory === scope.materialCategory)
        && (scope.allowedRegions === undefined || scope.allowedRegions.includes(row.region)));
      return res.json({ csv: trainingCsv(rows), filename: 'baliktela-synthetic-predictive-v1.csv', records: rows.length, isSynthetic: true });
    }
    const modelFilters = { region: scope.region, materialCategory: scope.materialCategory };
    const { value } = await cache.getOrCreate(dashboardAnalyticsCacheKey(actor, modelFilters), async () => buildPredictiveReport({ ...scope, historyWeeks: 120 }));
    return res.json({ ...value, history: value.history.slice(-(scope.historyWeeks ?? 26)) });
  };
  app.get('/api/analytics/predictive', requireAuth, authorize(store, 'analytics.predictive.read'), handler(false));
  app.get('/api/analytics/predictive/dataset', requireAuth, authorize(store, 'analytics.predictive.read'), authorize(store, 'reports.export'), handler(true));
}
