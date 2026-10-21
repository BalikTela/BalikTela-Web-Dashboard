import { config } from 'dotenv';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { decodeRecord } from '../server/database/codecs.js';
import { buildHubStorageAnalytics } from '../server/hubStorage.js';
import { hubFacilityAttributions } from '../server/hubFacilities.js';
import { HUB_STOCK_ESTIMATE_METHOD } from '../shared/hubStorage.js';
import type { DashboardSourceSnapshot } from '../server/store.js';
import type { MeasurementRecord } from '../server/types.js';

config({ path: '.env.supabase', quiet: true });
if (!process.env.SUPABASE_DB_URL) throw new Error('Configure the private database connection.');
const apply = process.argv.includes('--apply');
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15 });
try {
  const report = await sql.begin(apply ? 'isolation level repeatable read' : 'isolation level repeatable read read only', async tx => {
    await tx`set local statement_timeout = '30000'`;
    await tx`set local lock_timeout = '5000'`;
    if (apply) await tx`select pg_advisory_xact_lock(2110202602)`;
    const [{ snapshot }] = await tx`select public.get_dashboard_source_snapshot() snapshot`;
    const decode = (name: Parameters<typeof decodeRecord>[0], key: string) =>
      (snapshot[key] as Record<string, unknown>[]).map(row => decodeRecord(name, { ...row, _id: row.id }));
    const source = {
      allBatches: decode('materialBatches','materialBatches'), allTransfers: decode('transfers','transfers'),
      measurements: decode('measurements','measurements'), recoveryRecords: decode('recoveryRecords','recoveryRecords'),
      listings: decode('listings','listings'), offers: decode('offers','offers'), users: decode('users','users'),
      facilities: decode('facilities','facilities'), organizations: decode('organizations','organizations'),
      walletEntries: decode('walletEntries','walletEntries'), interactions: decode('systemInteractions','systemInteractions'),
    } as DashboardSourceSnapshot;
    const disposals = await tx`select id,listing_id,operator_id,listing_title,category,weight_kg,reason,disposed_at from public.hub_disposals`;
    source.hubDisposals = { available: true, records: disposals.map(row => ({ id: row.id, listingId: row.listing_id,
      operatorId: row.operator_id, listingTitle: row.listing_title, category: row.category, weightKg: Number(row.weight_kg),
      reason: row.reason, disposedAt: new Date(row.disposed_at).toISOString() })) };
    const actor = source.users.find(user => user.role === 'Administrator' && user.accountStatus === 'Active'
      && user.authUserId && /^Vinard\b/i.test(user.fullName));
    if (!actor) throw new Error('The authorizing administrator could not be identified.');
    const sites = source.facilities.filter(site => !site.isDemo && site.status !== 'Inactive'
      && source.organizations.some(org => org.id === site.organizationId));
    const now = new Date();
    const before = buildHubStorageAnalytics(source, sites, actor, now);
    const { relevant, batchSites } = hubFacilityAttributions(source, source.allBatches, actor, now, true);
    const estimates: MeasurementRecord[] = [];
    for (const site of sites.filter(site => before.rows.find(row => row.id === site.id)?.storedKg === null)) {
      for (const [batchId, evidence] of relevant) {
        if (batchSites.get(batchId) !== site.id || evidence.receipt) continue;
        const batch = source.allBatches.find(item => item.id === batchId)!;
        if (batch.isDemo) throw new Error('Historical fixture records cannot be reconciled as operational stock.');
        const roots = source.listings.filter(item => item.batchId === batchId && !item.remainderOfId && item.deliveryRoute !== 'direct');
        if (roots.length !== 1 || evidence.operatorIds.size !== 1) throw new Error('Resolve ambiguous listing ownership before estimating stock.');
        const listing = roots[0];
        const hasHandling = Boolean(listing.disposedAt || listing.disposedWeightKg || ['Completed','Closed'].includes(listing.status))
          || source.measurements.some(item => item.batchId === batchId && evidence.operatorIds.has(item.recordedBy)
            && item.canonicalStage === 'listing' && ['Measured','Verified'].includes(item.status));
        if (!hasHandling) continue;
        const remaining = listing.availableWeightKg ?? listing.quantityKg;
        if (remaining === null || !Number.isFinite(remaining) || remaining < 0) throw new Error('A valid remaining listing balance is required.');
        const id = `STOCK-EST-20261021-${site.id}-${batchId}`;
        if (source.measurements.some(item => item.id === id)) throw new Error('A previous stock estimate exists; do not silently overwrite it.');
        estimates.push({ id, batchId, transferId: null, facilityId: site.id, canonicalStage:'validation', stage:'Validation',
          status:'Estimated', weightKg:remaining, method:HUB_STOCK_ESTIMATE_METHOD, recordedBy:actor.id, verifiedBy:null,
          timestamp:now.toISOString(), supersedesMeasurementId:null,
          note:`User-authorized assumed stock balance based on listing ${listing.id} remaining quantity. Not a physical count, receipt, or verified outcome. Source records preserved.` });
      }
    }
    const afterSource = { ...source, measurements:[...source.measurements,...estimates] };
    const after = buildHubStorageAnalytics(afterSource, sites, actor, new Date(now.getTime()+1));
    if (estimates.length && after.rows.some(row => row.storedKg === null)) throw new Error('Remaining uncertainty requires reconciliation; no estimates will be committed.');
    if (apply) {
      const [{ unchanged }] = await tx`select not exists(select 1 from public.measurements where id like 'STOCK-EST-20261021-%') unchanged`;
      if (estimates.length && !unchanged) throw new Error('Existing estimates require manual review before another application.');
      for (const item of estimates) {
        await tx`insert into public.measurements
          (id,batch_id,transfer_id,facility_id,flow_event_id,stage,weight_kg,weight_status,method,measurement_context,
           recorded_by,verified_by,measured_at,note,supersedes_measurement_id,created_at)
          values (${item.id},${item.batchId},null,${item.facilityId!},null,'validation',${item.weightKg},'Estimated',
           ${item.method},'User-authorized assumption; storage only',${actor.id},null,${item.timestamp},${item.note},null,${item.timestamp})`;
        await tx`insert into public.activity_logs(id,actor_id,action,entity_type,entity_id,details,occurred_at)
          values (${`AUDIT-${item.id}`},${actor.id},'hub.stock.estimate','measurement',${item.id},
            ${tx.json({ source:'user_authorized_assumption', weightKg:item.weightKg, facilityId:item.facilityId,
              batchId:item.batchId, weightStatus:'Estimated', affectsVerifiedIntake:false })},${item.timestamp})`;
      }
      const inserted = estimates.length ? await tx`select id,weight_status,stage,verified_by from public.measurements
        where id=any(${tx.array(estimates.map(item => item.id))}::text[])` : [];
      assert.equal(inserted.length,estimates.length);
      assert.ok(inserted.every(row => row.weight_status === 'Estimated' && row.stage === 'validation' && row.verified_by === null));
    }
    return { action:apply ? 'applied' : 'preview', addedEstimatedStockBalances:estimates.length,
      verifiedReceiptsAdded:0, existingRecordsModified:0, hubs:after.rows.map(row => ({ name:row.name,
        capacityKg:row.capacityKg, storedKg:row.storedKg, reservedKg:row.reservedKg, disposedKg:row.disposedKg,
        utilization:row.utilization, headroomKg:row.availableToReceiveKg, status:row.status, estimatedStock:row.estimatedStock })) };
  });
  console.log(JSON.stringify(report,null,2));
} catch (error) {
  console.error(JSON.stringify({ message:error instanceof Error && !('code' in error) ? error.message : 'Storage reconciliation failed; no changes committed.',
    code:error && typeof error === 'object' && 'code' in error ? error.code : undefined }));
  process.exitCode = 1;
} finally { await sql.end({ timeout:5 }); }
