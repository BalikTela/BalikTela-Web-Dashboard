import type { Express } from 'express';
import { HUB_STOCK_CONFIRMATION_ACTION } from '../shared/hubStorage.js';
import { authorize, isWithinOperationalScope } from './access-control.js';
import { requireAuth, type AuthenticatedRequest } from './auth.js';
import { loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { createStockConfirmation, latestStockConfirmation } from './hubStockConfirmation.js';
import { ManagementError, text } from './management.js';
import { buildHubStorageAnalytics } from './hubStorage.js';
import type { Store } from './store.js';

export function registerHubStockRoutes(app: Express, store: Store) {
  app.post('/api/facilities/:id/stock-confirmations', requireAuth, authorize(store, 'facilities.manage'), async (req: AuthenticatedRequest, res) => {
    const actor = req.actor!;
    if (actor.role !== 'Administrator') throw new ManagementError('Only Admin can confirm Hub stock.', 403);
    const site = await store.findById('facilities', String(req.params.id));
    if (!site) throw new ManagementError('Hub not found.', 404);
    if (!isWithinOperationalScope(actor, { organizationIds: [site.organizationId], facilityIds: [site.id] })) throw new ManagementError('This Hub is outside your assigned scope.', 403);
    if (site.isDemo) throw new ManagementError('Select an operational Hub.');
    const { stockKg, countedAt, previousConfirmationId } = req.body;
    if (req.body.confirmed !== true) throw new ManagementError('Confirm that you checked the actual stock held at this Hub.');
    if (typeof stockKg !== 'number' || !Number.isFinite(stockKg) || stockKg < 0 || stockKg > 1e12) throw new ManagementError('Enter a valid, nonnegative current stock weight.');
    if (Math.abs(stockKg * 1e6 - Math.round(stockKg * 1e6)) > 0.01) throw new ManagementError('Use at most six decimal places in kilograms.');
    const reason = text(req.body.reason, 'Reason');
    const now = new Date(), at = typeof countedAt === 'string' ? Date.parse(countedAt) : NaN;
    if (!Number.isFinite(at) || at > now.getTime()) throw new ManagementError('Enter a valid stock count date and time that is not in the future.');
    if (previousConfirmationId !== null && typeof previousConfirmationId !== 'string') throw new ManagementError('Reload the Hub before confirming its stock.', 409);
    const snapshot = await loadDashboardAnalyticsSnapshot(store);
    if (!snapshot.hubDisposals?.available) throw new ManagementError('Disposal records are unavailable. Try again before confirming stock.', 503);
    const previous = latestStockConfirmation(snapshot, site.id);
    if ((previous?.id ?? null) !== previousConfirmationId) throw new ManagementError('Another stock confirmation was saved. Refresh and review the latest balance.', 409);
    if (previous) {
      const details = JSON.parse(previous.details) as { countedAt: string };
      if (at <= Date.parse(details.countedAt)) throw new ManagementError('The new count must be later than the previous stock count.');
    }
    const recordedAt = new Date(previous ? Math.max(now.getTime(), Date.parse(previous.timestamp) + 1) : now.getTime()).toISOString();
    const record = createStockConfirmation(snapshot, actor, site.id, stockKg, new Date(at).toISOString(), reason, recordedAt);
    // A deterministic successor ID makes concurrent confirmations conflict, even across servers.
    await store.commit([{ name: 'auditRecords', record }]);
    snapshot.stockConfirmations = [...snapshot.stockConfirmations ?? [], record];
    const row = buildHubStorageAnalytics(snapshot, [site], actor, now).rows[0];
    res.status(201).json({ action: HUB_STOCK_CONFIRMATION_ACTION, row });
  });
}
