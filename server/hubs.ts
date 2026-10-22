import type { Express, Response } from 'express';
import { setImmediate as yieldToIo } from 'node:timers/promises';
import { AsyncTtlCache, dashboardAnalyticsCacheKey } from './asyncCache.js';
import { manilaDate } from '../shared/reporting.js';
import { authorize } from './access-control.js';
import { requireAuth, type AuthenticatedRequest } from './auth.js';
import { selectHubCohort, selectAnalyticsCohort, loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { ManagementError, saveManagement, text } from './management.js';
import type { DashboardSourceSnapshot, Store } from './store.js';
import type { ListingRecord, MeasurementRecord, UserRecord } from './types.js';
import { isCompletedTransfer, isTerminalTransfer } from '../shared/workflows.js';
import { isApprovedHub, isHubCandidate, isHubWeighingMeasurement, type HubDirectory, type WeighingMonitoring, type HubDisposalMonitoring } from '../shared/hubs.js';
import { identifyHubOperators } from './stakeholders.js';
import { buildHubOperations } from './hubOperations.js';
import { validateReportQuery } from './reports.js';
import { aggregateHubDisposals } from './hubDisposals.js';
import { isStorageSimulationOperator } from '../shared/hubStorage.js';

const aggregateOnly = (actor: UserRecord) => actor.scope.aggregateOnly || actor.role === 'Government' || actor.role === 'Researcher';
const inRegionScope = (actor: UserRecord, region: string) => actor.role === 'Administrator' || !actor.scope.regions.length || actor.scope.regions.includes(region);
export function eligibleForWeighing(listing: ListingRecord) {
  return !listing.disposedAt && !(listing.disposedWeightKg ?? 0) && !listing.remainderPending && !(listing.reservedKg ?? 0)
    && (listing.canonicalStatus ? ['draft', 'available', 'archived'].includes(listing.canonicalStatus) : listing.status === 'Open');
}
function awaiting(listing: ListingRecord) { return listing.quantityKg === null; }

export async function buildHubDirectory(store: Store, actor: UserRecord, query: Record<string, unknown> = {}, suppliedSnapshot?: DashboardSourceSnapshot): Promise<HubDirectory> {
  const snapshot = suppliedSnapshot ?? await loadDashboardAnalyticsSnapshot(store);
  const { users, listings: allListings, measurements: allMeasurements, facilities, allBatches: batches, allTransfers: transfers } = snapshot;
  const locked = new Set(transfers.filter(item => !isTerminalTransfer(item.status)).map(item => item.listingId));
  const allowedBatches = new Set(batches.filter(item => inRegionScope(actor, item.region)).map(item => item.id));
  const listings = allListings.filter(item => allowedBatches.has(item.batchId));
  const measurements = allMeasurements.filter(item => allowedBatches.has(item.batchId));
  const selected = (key: string, all: string, actual: string | null) => !query[key] || query[key] === all || query[key] === actual;
  const hubIds = identifyHubOperators(snapshot);
  const hubs = users.filter(user => hubIds.has(user.id) && !isStorageSimulationOperator(user)).filter(user => ['Administrator', 'Government', 'Researcher'].includes(actor.role) || user.id === actor.id).filter(user => inRegionScope(actor, user.region)
    && selected('region', 'All regions', user.region) && selected('city', 'All cities', user.city)
    && selected('organizationId', 'All organizations', user.organizationId)
    && (!query.facilityId || query.facilityId === 'All facilities' || user.scope.facilityIds.includes(String(query.facilityId)))).map(user => {
    const assigned = listings.filter(listing => listing.weighingHubId === user.id);
    const history = measurements.filter(item => isHubMeasurement(item) && item.recordedBy === user.id);
    const assignedFacilities = facilities.filter(facility => user.scope.facilityIds.includes(facility.id) && inRegionScope(actor, facility.region));
    const state = ['Suspended', 'Deactivated'].includes(user.accountStatus) || user.canonicalVerification === 'suspended' ? 'Suspended' as const
      : user.canonicalVerification === 'rejected' ? 'Rejected' as const
      : isApprovedHub(user) ? 'Approved' as const : 'Pending approval' as const;
    const operations = buildHubOperations(snapshot, batches.filter(item => allowedBatches.has(item.id)), { ...user, webHubOperator: true }, 'Recorded history');
    return { id: user.id, name: user.fullName, email: user.email, role: user.role, organization: user.organization, organizationId: user.organizationId, city: user.city, region: user.region,
      location: user.location || [user.city, user.region].filter(Boolean).join(', '), state, emailVerified: Boolean(user.emailVerifiedAt), passwordInitialized: Boolean(user.passwordChangedAt),
      facilityIds: actor.role === 'Administrator' ? user.scope.facilityIds : assignedFacilities.map(item => item.id), facilities: assignedFacilities.map(item => ({ id: item.id, name: item.name, status: item.status })),
      assignedListings: assigned.length, awaitingWeighing: assigned.filter(item => awaiting(item) && eligibleForWeighing(item) && !locked.has(item.id)).length,
      measurementCount: history.length, lastWeighedAt: history.map(item => item.timestamp).sort().at(-1) ?? null,
      awaitingCollection: operations.summary.awaitingCollection, collectedKg: operations.summary.collectedKg,
      disposedKg: operations.summary.disposedKg, disposalRecords: operations.summary.disposalRecords };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const regions = [...new Set(hubs.map(item => item.region))].sort().map(region => {
    const rows = hubs.filter(item => item.region === region);
    return { region, operators: rows.length, approved: rows.filter(item => item.state === 'Approved').length, pending: rows.filter(item => item.state === 'Pending approval').length };
  });
  return { aggregateOnly: aggregateOnly(actor), hubs: aggregateOnly(actor) ? [] : hubs, regions,
    summary: { operators: hubs.length, approved: hubs.filter(item => item.state === 'Approved').length,
      pending: hubs.filter(item => item.state === 'Pending approval').length,
      suspended: hubs.filter(item => item.state === 'Suspended').length, awaitingWeighing: hubs.reduce((sum, item) => sum + item.awaitingWeighing, 0),
      unassignedFacilities: hubs.filter(item => !item.facilities.length).length } };
}

export async function buildWeighingMonitoring(store: Store, actor: UserRecord, query: Record<string, unknown>, now = new Date(), suppliedSnapshot?: DashboardSourceSnapshot): Promise<WeighingMonitoring> {
  // Read full evidence so provenance survives older compact snapshot projections too.
  const [snapshot, listings, measurements] = await Promise.all([suppliedSnapshot ?? loadDashboardAnalyticsSnapshot(store), store.all('listings'), store.all('measurements')]);
  const cohort = selectAnalyticsCohort(snapshot, actor, { ...query, dateRange: query.dateRange ?? 'All time' }, now);
  const batches = new Map(cohort.currentBatches.map(item => [item.id, item]));
  const scopedListings = listings.filter(item => batches.has(item.batchId));
  const users = new Map(snapshot.users.map(item => [item.id, item]));
  const facilities = new Map(snapshot.facilities.map(item => [item.id, item]));
  const source = measurements.filter(item => isHubMeasurement(item) && batches.has(item.batchId) && Date.parse(item.timestamp) <= now.getTime())
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
  const superseded = new Set(measurements.filter(item => Date.parse(item.timestamp) <= now.getTime()).map(item => item.supersedesMeasurementId).filter(Boolean));
  const latest = new Map<string, MeasurementRecord>();
  for (const item of source) if (!superseded.has(item.id) && !latest.has(item.batchId)) latest.set(item.batchId, item);
  const activeTransferListings = new Set(snapshot.allTransfers.filter(item => !isTerminalTransfer(item.status)).map(item => item.listingId));
  const tasks = scopedListings.filter(item => item.deliveryRoute === 'via_hub' || item.weighingHubId).map(item => {
    const batch = batches.get(item.batchId)!;
    const eligible = eligibleForWeighing(item) && !activeTransferListings.has(item.id);
    return { id: item.id, batchId: item.batchId, title: item.title, owner: users.get(item.ownerId)?.fullName || item.ownerName,
      hubId: item.weighingHubId ?? null, hub: users.get(item.weighingHubId ?? '')?.fullName ?? 'Not assigned', region: batch.region, city: batch.city,
      quantityKg: item.quantityKg, weightStatus: item.weightStatus, eligible,
      state: !eligible ? 'Locked' as const : awaiting(item) ? 'Awaiting weighing' as const : 'Weighed' as const, createdAt: item.createdAt };
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const history = source.map(item => {
    const transfer = snapshot.allTransfers.find(transfer => transfer.id === item.transferId);
    const related = scopedListings.filter(listing => transfer ? listing.id === transfer.listingId : listing.batchId === item.batchId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const listing = related[0];
    return { id: item.id, batchId: item.batchId, listingId: listing?.id ?? null, title: listing?.title ?? item.batchId,
      owner: users.get(listing?.ownerId ?? batches.get(item.batchId)!.sourceUserId)?.fullName ?? 'Unknown owner', operatorId: item.recordedBy,
      operator: users.get(item.recordedBy)?.fullName ?? 'Unknown operator', facilityId: item.facilityId ?? null,
      facility: item.facilityId ? facilities.get(item.facilityId)?.name ?? item.facilityId : 'Not recorded', weightKg: item.weightKg, weightStatus: item.status,
      stage: item.canonicalStage!, measuredAt: item.timestamp, note: item.note || item.method, current: latest.get(item.batchId)?.id === item.id,
      listingStatus: listing?.disposedAt ? 'Disposed' : listing?.status ?? 'Unavailable', recipients: snapshot.allTransfers.filter(transfer => transfer.listingId === listing?.id && isCompletedTransfer(transfer.status))
        .map(transfer => ({ id: transfer.id, name: users.get(transfer.recipientId)?.fullName ?? 'Unknown recipient', weightKg: transfer.agreedWeightKg })) };
  });
  const regions = [...new Set(cohort.currentBatches.map(item => item.region))].sort().map(region => {
    const ids = new Set(cohort.currentBatches.filter(item => item.region === region).map(item => item.id));
    return { region, awaiting: tasks.filter(item => item.region === region && item.state === 'Awaiting weighing').length,
      measurements: source.filter(item => ids.has(item.batchId)).length, latestWeighedKg: [...latest.values()].filter(item => ids.has(item.batchId)).reduce((sum, item) => sum + item.weightKg, 0) };
  });
  return { aggregateOnly: aggregateOnly(actor), tasks: aggregateOnly(actor) ? [] : tasks, history: aggregateOnly(actor) ? [] : history, regions,
    summary: { awaiting: tasks.filter(item => item.state === 'Awaiting weighing').length, locked: tasks.filter(item => item.state === 'Locked').length,
      measurements: source.length, latestWeighedKg: [...latest.values()].reduce((sum, item) => sum + item.weightKg, 0),
      verifiedBatches: [...latest.values()].filter(item => item.status === 'Verified').length,
      unweighedBatches: cohort.currentBatches.filter(item => item.declaredWeightKg === null).length } };
}

export function registerHubRoutes(app: Express, store: Store,
  readSnapshot = () => loadDashboardAnalyticsSnapshot(store),
  responseCache = new AsyncTtlCache<unknown>(30_000, 24)) {
  async function cached(req: AuthenticatedRequest, res: Response, kind: string,
    build: (snapshot: DashboardSourceSnapshot, now: Date) => unknown | Promise<unknown>) {
    const startedAt = performance.now(), now = new Date();
    const key = `${kind}:${dashboardAnalyticsCacheKey(req.actor!, { ...req.query, reportingDay: manilaDate(now) })}`;
    const result = await responseCache.getOrCreate(key, async () => {
      const snapshot = await readSnapshot();
      await yieldToIo();
      return build(snapshot, now);
    });
    res.setHeader('Server-Timing', `hub;dur=${(performance.now() - startedAt).toFixed(1)}`);
    res.setHeader('X-BalikTela-Cache', result.status);
    res.json(result.value);
  }
  app.use(['/api/hubs', '/api/weighing', '/api/hub-disposals', '/api/hub-operations'], (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  app.get('/api/hubs', requireAuth, authorize(store, 'hubs.read'), async (req: AuthenticatedRequest, res) =>
    cached(req, res, 'directory', snapshot => buildHubDirectory(store, req.actor!, req.query, snapshot)));
  app.get('/api/weighing', requireAuth, authorize(store, 'weighing.read'), async (req: AuthenticatedRequest, res) =>
    cached(req, res, 'weighing', (snapshot, now) => buildWeighingMonitoring(store, req.actor!, req.query, now, snapshot)));
  app.get('/api/hub-disposals', requireAuth, authorize(store, 'hubs.read'), async (req: AuthenticatedRequest, res) =>
    cached(req, res, 'disposals', (snapshot, now) => buildHubDisposalMonitoring(store, req.actor!, req.query, now, snapshot)));
  app.get('/api/hub-operations', requireAuth, authorize(store, 'hubs.read'), async (req: AuthenticatedRequest, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    validateReportQuery(req.query);
    return cached(req, res, 'operations', (snapshot, now) => {
      const actor = req.actor!;
      const { period, batches } = selectHubCohort(snapshot, actor, req.query, now);
      return buildHubOperations(snapshot, batches, actor, period.label, now);
    });
  });
  app.patch('/api/hubs/:id', requireAuth, authorize(store, 'hubs.manage'), async (req: AuthenticatedRequest, res) => {
    const target = await store.findById('users', String(req.params.id));
    if (!target || !isHubCandidate(target) || !identifyHubOperators(await loadDashboardAnalyticsSnapshot(store)).has(target.id)) throw new ManagementError('Hub collection/disposal operator not found.', 404);
    const action = String(req.body.action);
    if (!['approve', 'revoke', 'assign'].includes(action)) throw new ManagementError('Select a valid Hub action.');
    const reason = text(req.body.reason, 'Administrative reason');
    const updated: UserRecord = { ...target, scope: { ...target.scope } };
    if (req.body.facilityIds !== undefined) {
      if (!Array.isArray(req.body.facilityIds) || req.body.facilityIds.length > 100 || req.body.facilityIds.some((id: unknown) => typeof id !== 'string')) throw new ManagementError('Select valid facility assignments.');
      const facilities = await store.all('facilities');
      const ids = [...new Set<string>(req.body.facilityIds)];
      for (const id of ids) {
        const facility = facilities.find(item => item.id === id);
        if (!facility || facility.status === 'Inactive' || (target.organizationId && facility.organizationId !== target.organizationId)) throw new ManagementError('Assignments must be active facilities within the operator organization.');
      }
      updated.scope.facilityIds = ids;
    }
    if (action === 'approve') {
      if (['Suspended', 'Deactivated'].includes(target.accountStatus)) throw new ManagementError('Restore this account through User Accounts before approving Hub access.', 409);
      if (!target.emailVerifiedAt || !target.passwordChangedAt) throw new ManagementError('Verified email and an initialized private password are required before Hub approval.', 409);
      updated.verification = 'Demo verified'; updated.canonicalVerification = 'verified'; updated.organizationVerified = true; updated.accountStatus = 'Active';
    }
    if (action === 'revoke') { updated.verification = 'Pending demo review'; updated.canonicalVerification = 'pending'; updated.organizationVerified = false; }
    await saveManagement(store, req.actor!, [{ name: 'users', previous: target, record: updated }], `hub.${action}`, target.id, reason);
    responseCache.clear();
    const revokedSessions = await store.revokeUserSessions(target.id, new Date().toISOString());
    res.json({ message: action === 'approve' ? 'Hub collection and disposal access approved.' : action === 'revoke' ? 'Hub collection and disposal approval revoked.' : 'Hub facility assignment saved.', revokedSessions });
  });
}

export async function buildHubDisposalMonitoring(store: Store, actor: UserRecord, query: Record<string, unknown>, now = new Date(), suppliedSnapshot?: DashboardSourceSnapshot): Promise<HubDisposalMonitoring> {
  const snapshot = suppliedSnapshot ?? await loadDashboardAnalyticsSnapshot(store);
  const source = snapshot.hubDisposals ?? await store.loadHubDisposals?.() ?? { available: false, records: [] };
  // Archived/disposed batches remain in the disposal ledger; current availability is not a history filter.
  const cohort = selectHubCohort({ ...snapshot, hubDisposals: source }, actor, query, now);
  const selected = { ...snapshot, hubDisposals: source };
  return { ...aggregateHubDisposals(selected, cohort.batches, cohort.actor, now),
    handling: buildHubOperations(selected, cohort.batches, cohort.actor, cohort.period.label, now).summary };
}

function isHubMeasurement(item: MeasurementRecord) {
  return isHubWeighingMeasurement(item);
}
