import type { Express } from 'express';
import { authorize, scopeBatches } from './access-control.js';
import { requireAuth, type AuthenticatedRequest } from './auth.js';
import { filterBatches, selectAnalyticsCohort, loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { resolveReportingPeriod } from '../shared/reporting.js';
import { ManagementError, saveManagement, text } from './management.js';
import type { Store } from './store.js';
import type { ListingRecord, MeasurementRecord, UserRecord } from './types.js';
import { isCompletedTransfer, isTerminalTransfer } from '../shared/workflows.js';
import { HUB_ROLE, isApprovedHub, isHubCandidate, isHubWeighingMeasurement, type HubDirectory, type WeighingMonitoring, type HubDisposalMonitoring } from '../shared/hubs.js';

const aggregateOnly = (actor: UserRecord) => actor.scope.aggregateOnly || actor.role === 'Government';
const inRegionScope = (actor: UserRecord, region: string) => actor.role === 'Administrator' || !actor.scope.regions.length || actor.scope.regions.includes(region);
export function eligibleForWeighing(listing: ListingRecord) {
  return !listing.disposedAt && !(listing.disposedWeightKg ?? 0) && !listing.remainderPending && !(listing.reservedKg ?? 0)
    && (listing.canonicalStatus ? ['draft', 'available', 'archived'].includes(listing.canonicalStatus) : listing.status === 'Open');
}
function awaiting(listing: ListingRecord) { return listing.quantityKg === null; }

export async function buildHubDirectory(store: Store, actor: UserRecord, query: Record<string, unknown> = {}): Promise<HubDirectory> {
  const [users, allListings, allMeasurements, facilities, batches, transfers] = await Promise.all([store.all('users'), store.all('listings'), store.all('measurements'), store.all('facilities'), store.all('materialBatches'), store.all('transfers')]);
  const locked = new Set(transfers.filter(item => !isTerminalTransfer(item.status)).map(item => item.listingId));
  const allowedBatches = new Set(batches.filter(item => inRegionScope(actor, item.region)).map(item => item.id));
  const listings = allListings.filter(item => allowedBatches.has(item.batchId));
  const measurements = allMeasurements.filter(item => allowedBatches.has(item.batchId));
  const selected = (key: string, all: string, actual: string | null) => !query[key] || query[key] === all || query[key] === actual;
  const hubs = users.filter(isHubCandidate).filter(user => ['Administrator', 'Government', 'Researcher'].includes(actor.role) || user.id === actor.id).filter(user => inRegionScope(actor, user.region)
    && selected('region', 'All regions', user.region) && selected('city', 'All cities', user.city)
    && selected('organizationId', 'All organizations', user.organizationId)
    && (!query.facilityId || query.facilityId === 'All facilities' || user.scope.facilityIds.includes(String(query.facilityId)))).map(user => {
    const assigned = listings.filter(listing => listing.weighingHubId === user.id);
    const history = measurements.filter(item => isHubMeasurement(item) && item.recordedBy === user.id);
    const assignedFacilities = facilities.filter(facility => user.scope.facilityIds.includes(facility.id) && inRegionScope(actor, facility.region));
    const state = ['Suspended', 'Deactivated'].includes(user.accountStatus) || user.canonicalVerification === 'suspended' ? 'Suspended' as const
      : user.canonicalVerification === 'rejected' ? 'Rejected' as const
      : isApprovedHub(user) ? 'Approved' as const : 'Pending approval' as const;
    return { id: user.id, name: user.fullName, email: user.email, role: user.role, organization: user.organization, organizationId: user.organizationId, city: user.city, region: user.region,
      location: user.location || [user.city, user.region].filter(Boolean).join(', '), state, emailVerified: Boolean(user.emailVerifiedAt), passwordInitialized: Boolean(user.passwordChangedAt),
      facilityIds: actor.role === 'Administrator' ? user.scope.facilityIds : assignedFacilities.map(item => item.id), facilities: assignedFacilities.map(item => ({ id: item.id, name: item.name, status: item.status })),
      assignedListings: assigned.length, awaitingWeighing: assigned.filter(item => awaiting(item) && eligibleForWeighing(item) && !locked.has(item.id)).length,
      measurementCount: history.length, lastWeighedAt: history.map(item => item.timestamp).sort().at(-1) ?? null };
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

export async function buildWeighingMonitoring(store: Store, actor: UserRecord, query: Record<string, unknown>, now = new Date()): Promise<WeighingMonitoring> {
  // Read full evidence so provenance survives older compact snapshot projections too.
  const [snapshot, listings, measurements] = await Promise.all([loadDashboardAnalyticsSnapshot(store), store.all('listings'), store.all('measurements')]);
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

export function registerHubRoutes(app: Express, store: Store) {
  app.use(['/api/hubs', '/api/weighing', '/api/hub-disposals'], (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  app.get('/api/hubs', requireAuth, authorize(store, 'hubs.read'), async (req: AuthenticatedRequest, res) => res.json(await buildHubDirectory(store, req.actor!, req.query)));
  app.get('/api/weighing', requireAuth, authorize(store, 'weighing.read'), async (req: AuthenticatedRequest, res) => res.json(await buildWeighingMonitoring(store, req.actor!, req.query)));
  app.get('/api/hub-disposals', requireAuth, authorize(store, 'hubs.read'), async (req: AuthenticatedRequest, res) => res.json(await buildHubDisposalMonitoring(store, req.actor!, req.query)));
  app.patch('/api/hubs/:id', requireAuth, authorize(store, 'hubs.manage'), async (req: AuthenticatedRequest, res) => {
    const target = await store.findById('users', String(req.params.id));
    if (!target || !isHubCandidate(target)) throw new ManagementError('Hub operator not found.', 404);
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
    const revokedSessions = await store.revokeUserSessions(target.id, new Date().toISOString());
    res.json({ message: action === 'approve' ? 'Hub access approved.' : action === 'revoke' ? 'Hub weighing approval revoked.' : 'Hub facility assignment saved.', revokedSessions });
  });
}

export async function buildHubDisposalMonitoring(store: Store, actor: UserRecord, query: Record<string, unknown>, now = new Date()): Promise<HubDisposalMonitoring> {
  const [source, snapshot] = await Promise.all([store.loadHubDisposals?.() ?? Promise.resolve({ available: false, records: [] }), loadDashboardAnalyticsSnapshot(store)]);
  const privileged = ['Administrator', 'Government', 'Researcher'].includes(actor.role);
  // Archived/disposed batches remain in the disposal ledger; current availability is not a history filter.
  const personallyDisposed = new Set(source.records.filter(item=>item.operatorId===actor.id).map(item=>snapshot.listings.find(listing=>listing.id===item.listingId)?.batchId));
  const scoped = privileged ? snapshot.allBatches.filter(item => inRegionScope(actor, item.region)) : [...new Map([...scopeBatches(actor, snapshot.allBatches, snapshot),...snapshot.allBatches.filter(item=>personallyDisposed.has(item.id))].map(item=>[item.id,item])).values()];
  const period = resolveReportingPeriod(query, now, scoped.map(item => item.createdAt).sort()[0]);
  const batches = new Map(filterBatches(scoped, period, query, { transfers: snapshot.allTransfers, recoveryRecords: snapshot.recoveryRecords, users: snapshot.users, organizations: snapshot.organizations }).map(item => [item.id, item]));
  const listings = new Map(snapshot.listings.map(item => [item.id, item]));
  const users = new Map(snapshot.users.map(item => [item.id, item]));
  const unique = [...new Map(source.records.map(item => [item.id, item])).values()];
  const linked = unique.filter(item => batches.has(listings.get(item.listingId)?.batchId ?? '') && (!Number.isFinite(Date.parse(item.disposedAt)) || Date.parse(item.disposedAt) <= now.getTime()));
  const valid = linked.filter(item => Number.isFinite(Date.parse(item.disposedAt)) && Number.isFinite(item.weightKg) && item.weightKg > 0 && item.reason.trim() && item.operatorId);
  const records = valid.map(item => {
    const listing = listings.get(item.listingId)!, batch = batches.get(listing.batchId)!;
    return { ...item, batchId: batch.id, operator: users.get(item.operatorId)?.fullName ?? item.operatorId, region: batch.region || 'Not recorded', isDemo: batch.isDemo };
  }).sort((a,b) => b.disposedAt.localeCompare(a.disposedAt));
  return { available: source.available, aggregateOnly: aggregateOnly(actor), landfillAvoidedKg: null,
    summary: { records: records.length, disposedKg: records.reduce((sum,item) => sum + item.weightKg,0), listings: new Set(records.map(item => item.listingId)).size,
      missingLinks: actor.role === 'Administrator' ? unique.filter(item => !listings.has(item.listingId)).length : 0, invalidRecords: linked.length - valid.length },
    records: aggregateOnly(actor) ? [] : records };
}

function isHubMeasurement(item: MeasurementRecord) {
  return isHubWeighingMeasurement(item);
}
