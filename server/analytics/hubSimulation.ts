import { createHash } from 'node:crypto';
import { HUB_SIMULATION_PREFIX as P, HUB_SIMULATION_PROFILE_NOTE, illustrativeStorageCapacityKg } from '../../shared/hubStorage.js';
import type { DatabaseShape, FacilityRecord, UserRecord } from '../types.js';
import type { HubDisposalRecord } from '../../shared/hubs.js';

export const HUB_SIMULATION_AT = '2026-10-20T12:00:00.000Z';
const at = (hour: number) => `2026-10-20T${String(hour).padStart(2, '0')}:00:00.000Z`;
const plans = [
  ['FAC-001', .9, [0.4], false, 'Partial disposal reopened intake'],
  ['FAC-002', .9, [.4, .5], false, 'Complete disposal reopened intake'],
  ['FAC-003', .9, [], true, 'Incoming submission reaches cutoff'],
  ['SYN-FAC-CENTRAL-VISAYAS', .9, [], false, 'Received stock reaches cutoff'],
  ['SYN-FAC-DAVAO-REGION', .6, [.1], false, 'Partly disposed stock remains'],
  ['SYN-FAC-METRO-MANILA', .2, [], false, 'Received stock; preserve existing evidence gaps'],
  ['SYN-FAC-WESTERN-VISAYAS', .4, [], true, 'Incoming submission below cutoff'],
] as const;

export function buildHubSimulation(facilities: FacilityRecord[]) {
  const byId = new Map(facilities.map(item => [item.id, item]));
  const users: DatabaseShape['users'] = [], materialBatches: DatabaseShape['materialBatches'] = [],
    listings: DatabaseShape['listings'] = [], measurements: DatabaseShape['measurements'] = [];
  const disposals: Array<HubDisposalRecord & { ownerName: string; requestKey: string; fingerprint: string }> = [];
  const scenarios: Array<{ hubId: string; batchId: string; label: string; capacityKg: number; sentKg: number; receivedKg: number; disposedKg: number; heldKg: number; reservedKg: number }> = [];
  const profile = (site: FacilityRecord, operator: boolean): UserRecord => ({
    id: `${P}${operator ? 'OP' : 'CONSUMER'}-${site.id}`, authUserId: null, passwordHash: null,
    email: `${operator ? 'hub' : 'consumer'}.${site.id.toLowerCase()}@simulation.baliktela.invalid`,
    fullName: `${operator ? 'Hub operator' : 'Consumer'} - ${site.city} (synthetic simulation)`,
    role: operator ? 'Recycler' : 'Consumer', stakeholder: operator ? 'BalikTela Hub' : 'Consumer',
    organizationId: operator ? site.organizationId : null, organization: operator ? site.name : 'Synthetic simulation only',
    city: site.city, region: site.region, joinedAt: at(0), consentAt: '', emailVerifiedAt: null, passwordChangedAt: null,
    verification: 'Demo verified', organizationVerified: operator, canonicalVerification: 'verified', accountStatus: 'Deactivated',
    scope: { organizationIds: operator ? [site.organizationId] : [], facilityIds: operator ? [site.id] : [], regions: [site.region], canExport: false, aggregateOnly: false },
    trustPlaceholder: 0, profile: { ageGroup: 'Synthetic fixture, not a person', organizationSize: 'Synthetic', productionVolumeKg: 0,
      recyclingPractices: HUB_SIMULATION_PROFILE_NOTE, acceptedTextiles: site.acceptedMaterials, sustainabilityInterests: [] },
  });
  for (const [hubId, fraction, disposedFractions, pending, label] of plans) {
    const site = byId.get(hubId);
    if (!site?.isDemo) throw new Error(`Expected existing demo Hub ${hubId}; no real or missing Hub may be changed.`);
    const operator = profile(site, true), consumer = profile(site, false);
    users.push(operator, consumer);
    const capacityKg = illustrativeStorageCapacityKg(site.id), weight = Math.round(capacityKg * fraction);
    const disposed = disposedFractions.reduce((sum, part) => sum + Math.round(capacityKg * part), 0);
    const batchId = `${P}BAT-${site.id}`, listingId = `${P}LST-${site.id}`;
    const material = site.acceptedMaterials[0] ?? 'Cotton';
    materialBatches.push({ id: batchId, sourceUserId: consumer.id, sourceOrganizationId: null, materialCategory: material,
      wasteSource: 'Household', wasteForm: 'Garments', condition: 'Recyclable', circularPathway: 'Collection',
      declaredWeightKg: weight, currentWeightKg: weight - disposed, weightStatus: pending ? 'Estimated' : 'Measured',
      secondaryQuantity: null, secondaryUnit: null, city: site.city, region: site.region,
      currentStatus: disposed === weight ? 'Closed' : pending ? 'Listed' : 'Received',
      currentCustodianId: pending ? consumer.id : operator.id, createdAt: at(1), updatedAt: at(6), isDemo: true });
    listings.push({ id: listingId, batchId, ownerId: consumer.id, ownerOrganizationId: null, ownerName: consumer.fullName,
      title: `Hub simulation: ${label} (${site.city})`, description: `SYNTHETIC SIMULATION ONLY. ${label}. No real delivery, disposal or public collection service. Dataset ${P}.`,
      textileType: material, wasteSource: 'Household', wasteForm: 'Garments', circularPathway: 'Collection', quality: 'Recyclable',
      quantityKg: weight, availableWeightKg: 0, weightStatus: pending ? 'Estimated' : 'Measured',
      reservedKg: pending ? weight : 0, weighingHubId: operator.id, deliveryRoute: 'via_hub', exchangeFor: 'No real exchange - simulation only', rewardCredits: 0,
      city: site.city, region: site.region, status: disposed === weight ? 'Closed' : 'Reserved', canonicalStatus: disposed === weight ? 'closed' : 'reserved',
      disposedWeightKg: disposed, ...(disposed === weight ? { disposedAt: at(6) } : {}), createdAt: at(1), isDemo: true });
    measurements.push({ id: `${P}MSR-DECL-${site.id}`, batchId, transferId: null, facilityId: null, canonicalStage: 'declaration', stage: 'Declaration',
      weightKg: weight, status: 'Estimated', method: 'Synthetic consumer declaration', recordedBy: consumer.id, verifiedBy: null,
      timestamp: at(1), note: 'Synthetic fixture, not measured operational evidence.' });
    if (!pending) measurements.push({ id: `${P}MSR-INTAKE-${site.id}`, batchId, transferId: null, facilityId: site.id,
      canonicalStage: 'collection', stage: 'Receipt', weightKg: weight, status: 'Measured', method: 'Synthetic Hub intake scale',
      recordedBy: operator.id, verifiedBy: null, timestamp: at(2), note: 'Synthetic Hub intake. Physical receipt scenario, not a historical listing weighing.' });
    disposedFractions.forEach((part, index) => {
      const id = `${P}DSP-${site.id}-${index + 1}`, weightKg = Math.round(capacityKg * part);
      const reason = `Synthetic simulation only: ${label}; disposal ${index + 1}. No real waste disposed.`;
      disposals.push({ id, listingId, operatorId: operator.id, ownerName: consumer.fullName, listingTitle: listings.at(-1)!.title,
        category: material, weightKg, reason, disposedAt: at(4 + index * 2), requestKey: id,
        fingerprint: createHash('sha256').update(JSON.stringify({ id, listingId, weightKg, reason })).digest('hex') });
    });
    scenarios.push({ hubId, batchId, label, capacityKg, sentKg: weight, receivedKg: pending ? 0 : weight,
      disposedKg: disposed, heldKg: pending ? 0 : weight - disposed, reservedKg: pending ? weight : 0 });
  }
  return { dataset: P, users, materialBatches, listings, measurements, disposals, scenarios };
}
