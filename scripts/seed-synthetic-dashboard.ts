import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { encodeFlowEvent, encodeRecord } from '../server/database/codecs.js';
import type {
  DatabaseShape, FacilityRecord, LifecycleEventRecord, ListingRecord, MaterialBatchRecord, MeasurementRecord,
  OfferRecord, OrganizationRecord, RecoveryRecord, SystemInteractionRecord, TransferRecord, UserRecord, WalletEntryRecord,
} from '../server/types.js';
import { engagementRecords, regionProfiles, wasteRecords } from '../src/data/mockData.js';

if (process.env.SUPABASE_SYNTHETIC_SEED !== 'true') {
  console.error('Refusing to seed. Set SUPABASE_SYNTHETIC_SEED=true for an intentional synthetic-data operation.');
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const passwordHash = await bcrypt.hash(`Synthetic-${crypto.randomUUID()}`, 10);
const materials = ['Cotton', 'Polyester', 'Denim', 'Mixed fabric', 'Uniforms', 'Household linen'];
const slugs = new Map(regionProfiles.map((item) => [item.region, item.region.replaceAll(' ', '-').toUpperCase()]));

const organizations: OrganizationRecord[] = regionProfiles.flatMap((profile) => {
  const slug = slugs.get(profile.region)!;
  return [
    { id: `SYN-ORG-PROD-${slug}`, name: `Synthetic ${profile.region} Producer (demo)`, type: 'Producer', verification: 'Demo verified', recordLabel: 'Demo', region: profile.region, city: profile.cities[0], status: 'Confirmed demo', serviceAreas: profile.cities, acceptedMaterials: materials, contactEmail: `producer.${slug.toLowerCase()}@synthetic.baliktela.demo` },
    { id: `SYN-ORG-REC-${slug}`, name: `Synthetic ${profile.region} Recycler (demo)`, type: 'Recycler', verification: 'Demo verified', recordLabel: 'Demo', region: profile.region, city: profile.cities.at(-1)!, status: 'Confirmed demo', serviceAreas: profile.cities, acceptedMaterials: materials, contactEmail: `recycler.${slug.toLowerCase()}@synthetic.baliktela.demo` },
  ];
});

function syntheticUser(profile: (typeof regionProfiles)[number], role: 'Producer' | 'Recycler'): UserRecord {
  const slug = slugs.get(profile.region)!;
  const organizationId = `SYN-ORG-${role === 'Producer' ? 'PROD' : 'REC'}-${slug}`;
  const city = role === 'Producer' ? profile.cities[0] : profile.cities.at(-1)!;
  return {
    id: `SYN-USR-${role === 'Producer' ? 'PROD' : 'REC'}-${slug}`, authUserId: null,
    email: `${role.toLowerCase()}.${slug.toLowerCase()}@synthetic.baliktela.demo`, passwordHash,
    fullName: `Synthetic ${profile.region} ${role} Operator`, role, organizationId,
    organization: organizations.find((item) => item.id === organizationId)!.name, city, region: profile.region,
    joinedAt: '2026-01-02T00:00:00.000Z', consentAt: '2026-01-02T00:00:00.000Z', emailVerifiedAt: '2026-01-02T00:00:00.000Z', passwordChangedAt: '2026-01-02T00:00:00.000Z',
    verification: 'Demo verified', accountStatus: 'Active',
    scope: { organizationIds: [organizationId], facilityIds: role === 'Recycler' ? [`SYN-FAC-${slug}`] : [], regions: [profile.region], canExport: false, aggregateOnly: false },
    trustPlaceholder: role === 'Recycler' ? 84 : 79,
    profile: { ageGroup: 'Not applicable - synthetic record', organizationSize: role === 'Recycler' ? 'Medium' : 'Large', productionVolumeKg: role === 'Producer' ? 50000 : 0, recyclingPractices: 'Synthetic dashboard demonstration activity.', acceptedTextiles: role === 'Recycler' ? materials : [], sustainabilityInterests: ['Material traceability', 'Circular textile recovery'] },
  };
}

const users = regionProfiles.flatMap((profile) => [syntheticUser(profile, 'Producer'), syntheticUser(profile, 'Recycler')]);
const facilities: FacilityRecord[] = regionProfiles.map((profile) => {
  const slug = slugs.get(profile.region)!;
  const monthlyCapacityKg = Math.round(18000 * profile.share + 4500);
  return { id: `SYN-FAC-${slug}`, organizationId: `SYN-ORG-REC-${slug}`, name: `${profile.cities.at(-1)!} Recovery (demo)`, type: 'Recycler', city: profile.cities.at(-1)!, region: profile.region, serviceAreas: profile.cities, acceptedMaterials: materials, monthlyCapacityKg, currentIntakeKg: Math.round(monthlyCapacityKg * (0.55 + profile.share * 0.35)), status: profile.region === 'Central Visayas' ? 'Near capacity' : 'Available', verification: 'Demo verified', isDemo: true };
});

const materialBatches: MaterialBatchRecord[] = [];
const measurements: MeasurementRecord[] = [];
const listings: ListingRecord[] = [];
const offers: OfferRecord[] = [];
const transfers: TransferRecord[] = [];
const recoveryRecords: RecoveryRecord[] = [];
const walletEntries: WalletEntryRecord[] = [];
const flowEvents: Array<Record<string, unknown>> = [];

for (const record of wasteRecords) {
  const regionSlug = slugs.get(record.region)!;
  const suffix = record.id.replace('WF-', '');
  const batchId = `SYN-BAT-${suffix}`;
  const providerId = `SYN-USR-PROD-${regionSlug}`;
  const recipientId = `SYN-USR-REC-${regionSlug}`;
  const sourceOrganizationId = `SYN-ORG-PROD-${regionSlug}`;
  const facilityId = `SYN-FAC-${regionSlug}`;
  const createdAt = `${record.date}T01:00:00.000Z`;
  const batch: MaterialBatchRecord = {
    id: batchId, sourceUserId: providerId, sourceOrganizationId, materialCategory: record.textileType,
    wasteSource: record.stakeholderType === 'Consumer' ? 'Post-consumer' : record.stakeholderType === 'NGO' ? 'Institutional' : 'Pre-consumer',
    wasteForm: record.textileType === 'Uniforms' || record.textileType === 'Household linen' ? 'Garments' : 'Offcuts', condition: 'Recyclable', circularPathway: 'Recycling',
    declaredWeightKg: record.generatedKg, currentWeightKg: record.sortedKg, weightStatus: 'Verified', secondaryQuantity: null, secondaryUnit: null,
    city: record.city, region: record.region, currentStatus: 'Recovered', currentCustodianId: recipientId, createdAt, updatedAt: `${record.date}T08:00:00.000Z`, isDemo: true,
  };
  materialBatches.push(batch);
  measurements.push({ id: `SYN-MSR-${suffix}-DECL`, batchId, transferId: null, stage: 'Declaration', weightKg: record.generatedKg, status: 'Measured', method: 'Synthetic source declaration', recordedBy: providerId, verifiedBy: null, timestamp: createdAt, note: 'Synthetic demo measurement.' });

  const outcomes = [['Reuse', record.reusedKg], ['Recycling', record.recycledKg]] as const;
  outcomes.forEach(([outcome, weight], outcomeIndex) => {
    if (!weight) return;
    const code = outcome === 'Reuse' ? 'REU' : 'REC';
    const listingId = `SYN-LST-${suffix}-${code}`;
    const offerId = `SYN-OFR-${suffix}-${code}`;
    const transferId = `SYN-TRF-${suffix}-${code}`;
    const completedAt = `${record.date}T${String(6 + outcomeIndex).padStart(2, '0')}:00:00.000Z`;
    const measurementId = `SYN-MSR-${suffix}-${code}`;
    listings.push({ id: listingId, batchId, ownerId: providerId, ownerOrganizationId: sourceOrganizationId, ownerName: `Synthetic ${record.region} Producer (demo)`, title: `Synthetic ${record.textileType} ${outcome.toLowerCase()} lot`, description: 'Synthetic listing generated for dashboard integration testing.', textileType: record.textileType, wasteSource: batch.wasteSource, wasteForm: batch.wasteForm, circularPathway: outcome, quantityKg: weight, weightStatus: 'Verified', quality: outcome === 'Reuse' ? 'Reusable' : 'Recyclable', exchangeFor: 'Synthetic circular textile service', rewardCredits: weight * 2, city: record.city, region: record.region, status: 'Completed', createdAt, isDemo: true });
    offers.push({ id: offerId, listingId, listingTitle: `Synthetic ${record.textileType} ${outcome.toLowerCase()} lot`, recipientId, recipientName: `Synthetic ${record.region} Recycler (demo)`, providerId, quantityKg: weight, terms: 'Synthetic validated transfer terms.', offeredCredits: weight * 2, status: 'Accepted', createdAt, updatedAt: completedAt });
    measurements.push(
      { id: `SYN-MSR-${suffix}-${code}-HO`, batchId, transferId, stage: 'Handover', weightKg: weight, status: 'Verified', method: 'Synthetic handover scale', recordedBy: providerId, verifiedBy: recipientId, timestamp: `${record.date}T03:00:00.000Z`, note: 'Synthetic verified handover weight.' },
      { id: `SYN-MSR-${suffix}-${code}-RC`, batchId, transferId, stage: 'Receipt', weightKg: weight, status: 'Verified', method: 'Synthetic receiving scale', recordedBy: recipientId, verifiedBy: recipientId, timestamp: `${record.date}T04:00:00.000Z`, note: 'Synthetic verified receipt weight.' },
      { id: measurementId, batchId, transferId, stage: 'Validation', weightKg: weight, status: 'Verified', method: 'Synthetic facility validation', recordedBy: recipientId, verifiedBy: recipientId, timestamp: completedAt, note: 'Synthetic verified outcome weight.' },
    );
    const eventTypes: LifecycleEventRecord['type'][] = ['Offer accepted', 'Handover', 'Receipt', 'Validation', 'Completion'];
    const events: LifecycleEventRecord[] = eventTypes.map((type, index) => ({ id: `SYN-EVT-${suffix}-${code}-${index + 1}`, type, actorId: index < 2 ? providerId : recipientId, actorName: index < 2 ? `Synthetic ${record.region} Producer (demo)` : `Synthetic ${record.region} Recycler (demo)`, timestamp: `${record.date}T${String(2 + index).padStart(2, '0')}:00:00.000Z`, status: 'Completed', location: `${record.city}, ${record.region}`, note: `Synthetic ${type.toLowerCase()} event.`, measurementId: type === 'Validation' ? measurementId : null }));
    const transfer: TransferRecord = { id: transferId, listingId, batchId, offerId, providerId, recipientId, materialCategory: record.textileType, agreedWeightKg: weight, handoverWeightKg: weight, receiptWeightKg: weight, verifiedWeightKg: weight, status: 'Completed', discrepancyKg: 0, discrepancyReason: '', circularOutcome: outcome, agreedTerms: 'Synthetic validated transfer terms.', pendingRewardCredits: weight * 2, rewardIssuedAt: completedAt, events, createdAt, updatedAt: completedAt, isDemo: true };
    transfers.push(transfer);
    walletEntries.push({ id: `SYN-WLT-${suffix}-${code}`, userId: providerId, transferId, type: 'Earned', credits: weight * 2, description: `Synthetic reward for ${weight} kg ${outcome.toLowerCase()} completion`, createdAt: completedAt });
    events.forEach((event, index) => flowEvents.push(normalize(encodeFlowEvent(transferId, batchId, listingId, event, index + 1))));
  });

  const primaryTransferId = `SYN-TRF-${suffix}-REU`;
  recoveryRecords.push(
    { id: `SYN-RCV-${suffix}-COL`, transferId: primaryTransferId, batchId, facilityId, organizationId: `SYN-ORG-REC-${regionSlug}`, stage: 'Collection', inputWeightKg: record.generatedKg, outputWeightKg: record.collectedKg, residualWeightKg: record.generatedKg - record.collectedKg, outcome: 'Recycling', status: 'Validated', recordedBy: recipientId, validatedBy: recipientId, timestamp: `${record.date}T04:00:00.000Z`, note: 'Synthetic collection mass balance.', isDemo: true },
    { id: `SYN-RCV-${suffix}-SRT`, transferId: primaryTransferId, batchId, facilityId, organizationId: `SYN-ORG-REC-${regionSlug}`, stage: 'Sorting', inputWeightKg: record.collectedKg, outputWeightKg: record.sortedKg, residualWeightKg: record.collectedKg - record.sortedKg, outcome: 'Recycling', status: 'Validated', recordedBy: recipientId, validatedBy: recipientId, timestamp: `${record.date}T05:00:00.000Z`, note: 'Synthetic sorting mass balance.', isDemo: true },
  );
}

const systemInteractions: SystemInteractionRecord[] = engagementRecords.flatMap((record) => {
  const occurredAt = `2026-${String(record.monthIndex).padStart(2, '0')}-20T12:00:00.000Z`;
  const regionSlug = slugs.get(record.region)!;
  const values: Array<[SystemInteractionRecord['eventName'], number]> = [
    ['active_users', record.activeUsers], ['sessions', record.sessions], ['waste_submissions', record.wasteSubmissions], ['barter_actions', record.barterActions], ['report_exports', record.reportExports],
  ];
  return values.map(([eventName, count]) => ({ id: `SYN-INT-${record.monthIndex}-${regionSlug}-${record.city.replaceAll(' ', '-').toUpperCase()}-${eventName.toUpperCase()}`, userId: null, organizationId: null, sessionId: null, eventName, client: eventName === 'barter_actions' ? 'mobile' : 'web', properties: { count, averageSessionMinutes: eventName === 'sessions' ? record.averageSessionMinutes : undefined, region: record.region, city: record.city, synthetic: true }, privacyClassification: 'aggregate', occurredAt }));
});

const domainTables: Array<[keyof DatabaseShape, DatabaseShape[keyof DatabaseShape]]> = [
  ['organizations', organizations], ['users', users], ['facilities', facilities], ['materialBatches', materialBatches], ['measurements', measurements],
  ['listings', listings], ['offers', offers], ['transfers', transfers], ['recoveryRecords', recoveryRecords], ['walletEntries', walletEntries], ['systemInteractions', systemInteractions],
];

const tableNames: Record<string, string> = { organizations: 'organizations', users: 'users', facilities: 'facilities', materialBatches: 'material_batches', measurements: 'measurements', listings: 'listings', offers: 'match_requests', transfers: 'transfers', recoveryRecords: 'recovery_records', walletEntries: 'reward_ledger', systemInteractions: 'system_interactions' };
const seeded: Record<string, number> = {};
for (const [name, records] of domainTables) {
  const rows = records.map((record) => normalize(encodeRecord(name as never, record as never)));
  await upsertRows(tableNames[name], rows);
  seeded[tableNames[name]] = rows.length;
}
await upsertRows('flow_events', flowEvents);
seeded.flow_events = flowEvents.length;

console.log(JSON.stringify({ provider: 'supabase', dataset: 'synthetic-dashboard-v1', disclosure: 'All SYN- records are synthetic demo data.', seeded }, null, 2));

async function upsertRows(table: string, rows: Array<Record<string, unknown>>) {
  for (let index = 0; index < rows.length; index += 250) {
    const { error } = await supabase.from(table).upsert(rows.slice(index, index + 250), { onConflict: 'id' });
    if (error) throw new Error(`Could not seed ${table}: ${error.message}`);
  }
}

function normalize(value: unknown): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const document = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(document).map(([key, item]) => [key === '_id' ? 'id' : key, normalize(item)]).filter(([, item]) => item !== undefined));
  }
  return value;
}
