import { createHmac, randomBytes } from 'node:crypto';
import type { FacilityRecord, ListingRecord, MaterialBatchRecord, MeasurementRecord, RecoveryRecord, TransferRecord, UserRecord } from './types.js';

const researchKey = process.env.JWT_SECRET || randomBytes(32).toString('hex');

export function summaryActor(actor: UserRecord): UserRecord {
  return actor.role === 'Government' || actor.role === 'Researcher'
    ? { ...actor, scope: { ...actor.scope, aggregateOnly: true, organizationIds: [], facilityIds: [] } } : actor;
}

// Coded references are stable within one researcher's view, not reversible source IDs.
function reference(actor: UserRecord, kind: string, id: string): string;
function reference(actor: UserRecord, kind: string, id: string | null | undefined): string | null;
function reference(actor: UserRecord, kind: string, id: string | null | undefined) {
  if (!id) return null;
  const code = createHmac('sha256', researchKey)
    .update(JSON.stringify([actor.id, kind, id])).digest('hex').slice(0, 16);
  return `${kind}-${code}`;
}

export function researchMeasurement(actor: UserRecord, row: MeasurementRecord): MeasurementRecord {
  return { ...row, id: reference(actor, 'MEASUREMENT', row.id), batchId: reference(actor, 'BATCH', row.batchId),
    transferId: reference(actor, 'TRANSACTION', row.transferId), recordedBy: reference(actor, 'PARTICIPANT', row.recordedBy),
    verifiedBy: reference(actor, 'PARTICIPANT', row.verifiedBy), facilityId: reference(actor, 'HUB', row.facilityId),
    supersedesMeasurementId: reference(actor, 'MEASUREMENT', row.supersedesMeasurementId), method: 'Method withheld', note: '' };
}

export function researchBatch(actor: UserRecord, row: MaterialBatchRecord): MaterialBatchRecord {
  return { ...row, id: reference(actor, 'BATCH', row.id), sourceUserId: reference(actor, 'PARTICIPANT', row.sourceUserId),
    sourceOrganizationId: reference(actor, 'ORGANIZATION', row.sourceOrganizationId), currentCustodianId: reference(actor, 'PARTICIPANT', row.currentCustodianId),
    city: '', secondaryQuantity: null, secondaryUnit: null };
}

export function researchListing(actor: UserRecord, row: ListingRecord): ListingRecord {
  return { ...row, id: reference(actor, 'LISTING', row.id), batchId: reference(actor, 'BATCH', row.batchId),
    ownerId: reference(actor, 'PARTICIPANT', row.ownerId), ownerOrganizationId: reference(actor, 'ORGANIZATION', row.ownerOrganizationId),
    ownerName: reference(actor, 'PARTICIPANT', row.ownerId), title: `${row.textileType} textile listing`, description: '', exchangeFor: '', city: '',
    weighingHubId: reference(actor, 'PARTICIPANT', row.weighingHubId), remainderOfId: reference(actor, 'LISTING', row.remainderOfId) };
}

export function researchTransfer(actor: UserRecord, row: TransferRecord) {
  return { ...row, id: reference(actor, 'TRANSACTION', row.id), listingId: reference(actor, 'LISTING', row.listingId), batchId: reference(actor, 'BATCH', row.batchId),
    offerId: reference(actor, 'OFFER', row.offerId), providerId: reference(actor, 'PARTICIPANT', row.providerId), recipientId: reference(actor, 'PARTICIPANT', row.recipientId),
    requesterName: reference(actor, 'PARTICIPANT', row.recipientId), agreedTerms: '', discrepancyReason: row.discrepancyReason ? 'Reason recorded; details withheld' : '',
    events: row.events.map(event => ({ ...event, id: reference(actor, 'EVENT', event.id), actorId: reference(actor, 'PARTICIPANT', event.actorId),
      actorName: reference(actor, 'PARTICIPANT', event.actorId), location: '', note: '', measurementId: reference(actor, 'MEASUREMENT', event.measurementId) })) };
}

export function researchRecovery(actor: UserRecord, row: RecoveryRecord): RecoveryRecord {
  return { ...row, id: reference(actor, 'RECOVERY', row.id), batchId: reference(actor, 'BATCH', row.batchId), transferId: reference(actor, 'TRANSACTION', row.transferId),
    facilityId: reference(actor, 'HUB', row.facilityId), organizationId: reference(actor, 'ORGANIZATION', row.organizationId),
    recordedBy: reference(actor, 'PARTICIPANT', row.recordedBy), validatedBy: reference(actor, 'PARTICIPANT', row.validatedBy), note: '' };
}

export function researchFacility(actor: UserRecord, row: FacilityRecord): FacilityRecord {
  return { ...row, id: reference(actor, 'HUB', row.id), name: reference(actor, 'HUB', row.id), organizationId: reference(actor, 'ORGANIZATION', row.organizationId), city: '', serviceAreas: [] };
}
