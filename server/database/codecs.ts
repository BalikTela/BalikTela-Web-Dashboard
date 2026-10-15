import type { Document } from 'mongodb';
import type { DatabaseShape, LifecycleEventRecord } from '../types.js';

export type DomainCollectionName = keyof DatabaseShape;
export type DomainRecord<K extends DomainCollectionName> = DatabaseShape[K][number];

const now = () => new Date();
const toDate = (value: unknown) => value instanceof Date ? value : new Date(String(value));
const toIso = (value: unknown) => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const nullableIso = (value: unknown) => value ? toIso(value) : null;
const value = <T>(input: unknown, fallback: T): T => input === undefined || input === null ? fallback : input as T;
const stringArray = (input: unknown) => Array.isArray(input) ? input.map(String) : [];

const accountStatusToDb = { Active: 'active', 'Pending verification': 'pending_verification', Suspended: 'suspended', Deactivated: 'deactivated' } as const;
const accountStatusFromDb = { active: 'Active', pending_verification: 'Pending verification', suspended: 'Suspended', deactivated: 'Deactivated' } as const;
const verificationToDb = { 'Demo verified': 'verified', 'Pending demo review': 'pending' } as const;
const verificationFromDb = { verified: 'Demo verified', pending: 'Pending demo review', rejected: 'Pending demo review', suspended: 'Pending demo review' } as const;
const listingStatusToDb = { Open: 'available', Matched: 'matched', Reserved: 'reserved', Completed: 'completed', Closed: 'closed' } as const;
const listingStatusFromDb = { draft: 'Closed', available: 'Open', matched: 'Matched', reserved: 'Reserved', completed: 'Completed', closed: 'Closed', archived: 'Closed' } as const;
const offerStatusToDb = { Pending: 'pending', Accepted: 'accepted', Declined: 'rejected', Withdrawn: 'withdrawn' } as const;
const offerStatusFromDb = { pending: 'Pending', revised: 'Pending', accepted: 'Accepted', rejected: 'Declined', withdrawn: 'Withdrawn', expired: 'Declined' } as const;
const transferStatusToDb = { Reserved: 'reserved', 'Handed over': 'handed_over', Received: 'received', Validated: 'validated', Completed: 'completed', Cancelled: 'cancelled', Rejected: 'rejected', Disputed: 'disputed' } as const;
const transferStatusFromDb = { reserved: 'Reserved', in_progress: 'Reserved', handed_over: 'Handed over', collected: 'Received', received: 'Received', processing: 'Received', validated: 'Validated', completed: 'Completed', cancelled: 'Cancelled', rejected: 'Rejected', disputed: 'Disputed' } as const;

const batchStatusToDb: Record<string, string> = {
  Recorded: 'recorded', Listed: 'listed', Reserved: 'reserved', 'In transit': 'in_transit', Received: 'received', Validated: 'received', Recovered: 'recovered', Closed: 'closed', Archived: 'archived',
};
const batchStatusFromDb: Record<string, string> = {
  recorded: 'Recorded', draft: 'Recorded', listed: 'Listed', reserved: 'Reserved', in_transit: 'In transit', collected: 'Received', received: 'Received', validated: 'Validated', processing: 'Received', reused: 'Recovered', upcycled: 'Recovered', recycled: 'Recovered', recovered: 'Recovered', rejected: 'Closed', closed: 'Closed', archived: 'Archived',
};

const measurementStageToDb: Record<string, string> = { Declaration: 'declaration', Handover: 'handover', Receipt: 'receipt', Validation: 'validation', Recovery: 'recovery_output' };
const measurementStageFromDb: Record<string, string> = { declaration: 'Declaration', listing: 'Declaration', handover: 'Handover', collection: 'Receipt', receipt: 'Receipt', processing_input: 'Recovery', recovery_output: 'Recovery', rejection: 'Recovery', loss: 'Recovery', validation: 'Validation' };

const organizationTypeToDb = (type: string) => ({ Research: 'Research institution', Government: 'Government agency', Producer: 'Producer/Retailer', Recycler: 'Recycler', NGO: 'NGO/Community', 'LGU/Collection Point': 'LGU/MRF', Upcycler: 'Upcycler' }[type] ?? type);
const organizationStatusToDb = (status: string) => ({ 'Confirmed demo': 'active', 'Prospective sample': 'prospective', Inactive: 'inactive' }[status] ?? 'prospective');
const facilityStatusToDb = (status: string) => ({ Available: 'available', 'Near capacity': 'near_capacity', Maintenance: 'maintenance', 'Pilot onboarding': 'onboarding', Inactive: 'inactive' }[status] ?? 'onboarding');
const facilityStatusFromDb = (status: string) => ({ available: 'Available', near_capacity: 'Near capacity', maintenance: 'Maintenance', onboarding: 'Pilot onboarding', inactive: 'Inactive' }[status] ?? 'Pilot onboarding');

export function encodeRecord<K extends DomainCollectionName>(name: K, record: DomainRecord<K>): Document {
  const r = record as any;
  switch (name) {
    case 'users': return {
      _id: r.id, auth_user_id: r.authUserId, email: r.email, passwordHash: r.passwordHash, name: r.fullName, role: r.role, active: !['Suspended', 'Deactivated'].includes(r.accountStatus), stakeholder: r.role,
      organization_id: r.organizationId, organization: r.organization, organization_verified: r.verification === 'Demo verified', verification_status: verificationToDb[r.verification as keyof typeof verificationToDb],
      account_status: accountStatusToDb[r.accountStatus as keyof typeof accountStatusToDb], bio: '', location: [r.city, r.region].filter(Boolean).join(', '), city: r.city, region: r.region,
      phone: '', avatar_uri: null, rating: 5, swaps: 0, privacy_consent: Boolean(r.consentAt), research_consent: r.role === 'Researcher', notification_enabled: true,
      scope: { organization_ids: r.scope.organizationIds, facility_ids: r.scope.facilityIds, regions: r.scope.regions, can_export: r.scope.canExport, aggregate_only: r.scope.aggregateOnly },
      profile: { age_group: r.profile.ageGroup, organization_size: r.profile.organizationSize, production_volume_kg: r.profile.productionVolumeKg, recycling_practices: r.profile.recyclingPractices, accepted_textiles: r.profile.acceptedTextiles, sustainability_interests: r.profile.sustainabilityInterests },
      trust_placeholder: r.trustPlaceholder, last_login_at: null, created_at: toDate(r.joinedAt), updated_at: now(),
    };
    case 'organizations': return {
      _id: r.id, name: r.name, type: organizationTypeToDb(r.type), verification_status: verificationToDb[r.verification as keyof typeof verificationToDb], status: organizationStatusToDb(r.status),
      record_label: String(r.recordLabel).toLowerCase(), region: r.region, city: r.city, address: [r.city, r.region].filter(Boolean).join(', '), service_areas: r.serviceAreas,
      accepted_materials: r.acceptedMaterials, contact_email: r.contactEmail, created_at: now(), updated_at: now(),
    };
    case 'facilities': return {
      _id: r.id, organization_id: r.organizationId, name: r.name, type: r.type, address: [r.city, r.region].filter(Boolean).join(', '), city: r.city, region: r.region,
      location: { type: 'Point', coordinates: [0, 0] }, categories: r.acceptedMaterials, pathways: ['Collection', 'Reuse', 'Upcycling', 'Recycling', 'Recovery'],
      schedule: 'Schedule pending confirmation', instructions: '', service_areas: r.serviceAreas, monthly_capacity_kg: r.monthlyCapacityKg, current_intake_kg: r.currentIntakeKg,
      verification_status: verificationToDb[r.verification as keyof typeof verificationToDb], status: facilityStatusToDb(r.status), is_demo: r.isDemo, created_at: now(), updated_at: now(),
    };
    case 'materialBatches': return {
      _id: r.id, source_user_id: r.sourceUserId, source_organization_id: r.sourceOrganizationId, material_category: r.materialCategory, composition: '', waste_source: r.wasteSource,
      waste_form: r.wasteForm, condition: r.condition, intended_pathway: r.circularPathway, final_pathway: r.currentStatus === 'Recovered' ? r.circularPathway : null,
      declared_weight_kg: r.declaredWeightKg, current_weight_kg: r.currentWeightKg, weight_status: r.weightStatus, secondary_quantity: r.secondaryQuantity, secondary_unit: r.secondaryUnit,
      location: { city: r.city, region: r.region, barangay: '', latitude: null, longitude: null }, current_status: batchStatusToDb[r.currentStatus] ?? 'recorded',
      current_custodian_id: r.currentCustodianId, validation_status: r.weightStatus === 'Verified' ? 'valid' : 'pending', is_demo: r.isDemo, archived_at: r.archivedAt ? toDate(r.archivedAt) : null, created_at: toDate(r.createdAt), updated_at: toDate(r.updatedAt),
    };
    case 'measurements': return {
      _id: r.id, batch_id: r.batchId, transfer_id: r.transferId, facility_id: null, flow_event_id: null, stage: measurementStageToDb[r.stage] ?? 'declaration', weight_kg: r.weightKg,
      weight_status: r.status, method: r.method, measurement_context: r.note || r.method, recorded_by: r.recordedBy, verified_by: r.verifiedBy, measured_at: toDate(r.timestamp),
      note: r.note, supersedes_measurement_id: null, created_at: toDate(r.timestamp),
    };
    case 'listings': return {
      _id: r.id, batch_id: r.batchId, owner_id: r.ownerId, owner_organization_id: r.ownerOrganizationId, owner_name: r.ownerName, title: r.title, description: r.description,
      looking_for: r.exchangeFor ? [r.exchangeFor] : [], media: [], available_weight_kg: r.quantityKg, reserved_kg: ['Reserved', 'Completed'].includes(r.status) ? r.quantityKg : 0,
      category: r.textileType, condition: r.quality, location: [r.city, r.region].filter(Boolean).join(', '), city: r.city, region: r.region, weight_kg: r.quantityKg,
      weight_status: r.weightStatus, waste_source: r.wasteSource, waste_form: r.wasteForm, pathway: r.circularPathway, reward_points: Math.round(r.rewardCredits), is_demo: r.isDemo,
      status: listingStatusToDb[r.status as keyof typeof listingStatusToDb], published_at: toDate(r.createdAt), created_at: toDate(r.createdAt), updated_at: now(),
    };
    case 'offers': return {
      _id: r.id, requester_id: r.recipientId, requester_organization_id: null, listing_id: r.listingId, listing_title: r.listingTitle, requester_name: r.recipientName,
      provider_id: r.providerId, requested_kg: r.quantityKg, terms: r.terms, incentive_points: Math.round(r.offeredCredits), status: offerStatusToDb[r.status as keyof typeof offerStatusToDb],
      version: 1, previous_terms: [], responded_by: r.status === 'Pending' || r.status === 'Withdrawn' ? null : r.providerId, responded_at: r.status === 'Pending' ? null : toDate(r.updatedAt),
      created_at: toDate(r.createdAt), updated_at: toDate(r.updatedAt),
    };
    case 'transfers': return {
      _id: r.id, listing_id: r.listingId, batch_id: r.batchId, match_request_id: r.offerId, provider_id: r.providerId, provider_organization_id: null, recipient_id: r.recipientId,
      recipient_organization_id: null, material_category: r.materialCategory, agreed_weight_kg: r.agreedWeightKg, transfer_type: 'barter', status: transferStatusToDb[r.status as keyof typeof transferStatusToDb],
      agreed_terms: r.agreedTerms, circular_outcome: r.circularOutcome, discrepancy_kg: r.discrepancyKg, discrepancy_reason: r.discrepancyReason,
      pending_reward_points: Math.round(r.pendingRewardCredits), reward_issued_at: r.rewardIssuedAt ? toDate(r.rewardIssuedAt) : null, is_demo: r.isDemo,
      validation_status: ['Validated', 'Completed'].includes(r.status) ? 'valid' : r.status === 'Disputed' ? 'flagged' : 'pending', completed_at: r.status === 'Completed' ? toDate(r.updatedAt) : null,
      cancelled_at: r.status === 'Cancelled' ? toDate(r.updatedAt) : null, created_at: toDate(r.createdAt), updated_at: toDate(r.updatedAt),
    };
    case 'recoveryRecords': return {
      _id: r.id, transfer_id: r.transferId, batch_id: r.batchId, facility_id: r.facilityId, organization_id: r.organizationId, actor_id: r.recordedBy, validated_by: r.validatedBy,
      stage: r.stage, input_kg: r.inputWeightKg, output_kg: r.outputWeightKg, rejected_kg: r.residualWeightKg, loss_kg: 0, outcome: r.outcome,
      status: String(r.status).toLowerCase(), is_demo: r.isDemo, note: r.note, created_at: toDate(r.timestamp), updated_at: toDate(r.timestamp),
    };
    case 'conversations': return {
      _id: r.id, listing_id: r.listingId, transfer_id: null, participant_ids: r.participantIds, participant_names: r.participantNames,
      created_at: toDate(r.updatedAt), updated_at: toDate(r.updatedAt),
    };
    case 'messages': return {
      _id: r.id, conversation_id: r.conversationId, sender_id: r.senderId, sender_name: r.senderName, body: r.body, read_by: [], created_at: toDate(r.createdAt), edited_at: null,
    };
    case 'walletEntries': return {
      _id: r.id, user_id: r.userId, transfer_id: r.transferId, rule_id: null, points: Math.round(r.credits), entry_type: ({ Earned: 'earned', Redeemed: 'redemption', Adjustment: 'adjustment' } as Record<string, string>)[r.type],
      title: r.description, idempotency_key: `web-${r.id}`, created_at: toDate(r.createdAt),
    };
    case 'auditRecords': return {
      _id: r.id, actor_id: r.actorId || null, action: r.action, entity_type: r.entityType, entity_id: r.entityId, details: { summary: r.details }, ip_hash: null, occurred_at: toDate(r.timestamp),
    };
    case 'systemInteractions': return {
      _id: r.id, user_id: r.userId, organization_id: r.organizationId, session_id: r.sessionId, event_name: r.eventName, client: r.client,
      properties: r.properties, privacy_classification: r.privacyClassification, occurred_at: toDate(r.occurredAt),
    };
    case 'configurations': return {
      _id: `CFG-${r.id}-v1`, key: r.id, version: 1, status: 'active', value: {
        materialCategories: r.materialCategories, wasteSources: r.wasteSources, wasteForms: r.wasteForms, circularPathways: r.circularPathways,
        facilityTypes: r.facilityTypes, weightStatuses: r.weightStatuses, discrepancyThresholdPercent: r.discrepancyThresholdPercent,
        rewardCreditsPerVerifiedKg: r.rewardCreditsPerVerifiedKg, matchingWeights: r.matchingWeights, methodologyVersion: r.methodologyVersion,
      }, effective_from: toDate(r.updatedAt), updated_by: r.updatedBy, created_at: toDate(r.updatedAt), updated_at: toDate(r.updatedAt),
    };
  }
  throw new Error(`Unsupported domain collection: ${String(name)}`);
}

export function decodeRecord<K extends DomainCollectionName>(name: K, document: Document): DomainRecord<K> {
  const d = document as any;
  let decoded: any;
  switch (name) {
    case 'users': decoded = {
      id: String(d._id), authUserId: value(d.auth_user_id, null), email: d.email, passwordHash: value(d.passwordHash, null), fullName: d.name, role: d.role, organizationId: value(d.organization_id, null), organization: value(d.organization, ''),
      city: value(d.city, ''), region: value(d.region, ''), joinedAt: toIso(d.created_at), consentAt: d.privacy_consent ? toIso(d.created_at) : '',
      emailVerifiedAt: d._security ? nullableIso(d._security.email_verified_at) : Object.hasOwn(d, 'email_verified_at') ? nullableIso(d.email_verified_at) : (d.verification_status === 'verified' ? toIso(d.created_at) : null),
      passwordChangedAt: d._security ? nullableIso(d._security.password_changed_at) : Object.hasOwn(d, 'password_changed_at') ? nullableIso(d.password_changed_at) : toIso(d.created_at),
      verification: verificationFromDb[value(d.verification_status, d.organization_verified ? 'verified' : 'pending') as keyof typeof verificationFromDb],
      accountStatus: accountStatusFromDb[value(d.account_status, d.active ? 'active' : 'suspended') as keyof typeof accountStatusFromDb],
      scope: { organizationIds: stringArray(d.scope?.organization_ids), facilityIds: stringArray(d.scope?.facility_ids), regions: stringArray(d.scope?.regions), canExport: Boolean(d.scope?.can_export), aggregateOnly: Boolean(d.scope?.aggregate_only) },
      trustPlaceholder: Number(value(d.trust_placeholder, 50)), profile: { ageGroup: value(d.profile?.age_group, ''), organizationSize: value(d.profile?.organization_size, ''), productionVolumeKg: Number(value(d.profile?.production_volume_kg, 0)), recyclingPractices: value(d.profile?.recycling_practices, ''), acceptedTextiles: stringArray(d.profile?.accepted_textiles), sustainabilityInterests: stringArray(d.profile?.sustainability_interests) },
    }; break;
    case 'organizations': decoded = {
      id: String(d._id), name: d.name, type: d.type, verification: verificationFromDb[d.verification_status as keyof typeof verificationFromDb], recordLabel: d.record_label === 'demo' ? 'Demo' : 'Sample',
      region: d.region, city: d.city, status: d.status === 'active' ? 'Confirmed demo' : d.status === 'inactive' ? 'Inactive' : 'Prospective sample', serviceAreas: stringArray(d.service_areas), acceptedMaterials: stringArray(d.accepted_materials), contactEmail: value(d.contact_email, ''),
    }; break;
    case 'facilities': decoded = {
      id: String(d._id), organizationId: d.organization_id, name: d.name, type: d.type, city: d.city, region: d.region, serviceAreas: stringArray(d.service_areas), acceptedMaterials: stringArray(d.categories),
      monthlyCapacityKg: Number(value(d.monthly_capacity_kg, 0)), currentIntakeKg: Number(value(d.current_intake_kg, 0)), status: facilityStatusFromDb(d.status),
      verification: verificationFromDb[d.verification_status as keyof typeof verificationFromDb], isDemo: Boolean(d.is_demo),
    }; break;
    case 'materialBatches': decoded = {
      id: String(d._id), sourceUserId: d.source_user_id, sourceOrganizationId: value(d.source_organization_id, null), materialCategory: d.material_category, wasteSource: d.waste_source,
      wasteForm: d.waste_form, condition: d.condition, circularPathway: value(d.final_pathway, d.intended_pathway), declaredWeightKg: Number(d.declared_weight_kg), currentWeightKg: Number(d.current_weight_kg),
      weightStatus: d.weight_status, secondaryQuantity: value(d.secondary_quantity, null), secondaryUnit: value(d.secondary_unit, null), city: d.location.city, region: d.location.region,
      currentStatus: d.current_status === 'received' && d.weight_status === 'Verified' ? 'Validated' : batchStatusFromDb[d.current_status] ?? 'Recorded', archivedAt: nullableIso(d.archived_at), currentCustodianId: d.current_custodian_id, createdAt: toIso(d.created_at), updatedAt: toIso(d.updated_at), isDemo: Boolean(d.is_demo),
    }; break;
    case 'measurements': decoded = {
      id: String(d._id), batchId: d.batch_id, transferId: value(d.transfer_id, null), stage: measurementStageFromDb[d.stage] ?? 'Declaration', weightKg: Number(d.weight_kg), status: d.weight_status,
      method: d.method, recordedBy: d.recorded_by, verifiedBy: value(d.verified_by, null), timestamp: toIso(d.measured_at), note: value(d.note, ''),
    }; break;
    case 'listings': {
      const batch = d._batch ?? {};
      decoded = {
        id: String(d._id), batchId: d.batch_id, ownerId: d.owner_id, ownerOrganizationId: value(d.owner_organization_id, null), ownerName: value(d.owner_name, ''), title: d.title, description: d.description,
        textileType: value(d.category, batch.material_category ?? ''), wasteSource: value(d.waste_source, batch.waste_source ?? 'Unknown'), wasteForm: value(d.waste_form, batch.waste_form ?? 'Other'),
        circularPathway: value(d.pathway, batch.intended_pathway ?? 'For assessment'), quantityKg: Number(value(d.weight_kg, d.available_weight_kg)), weightStatus: value(d.weight_status, batch.weight_status ?? 'Estimated'),
        quality: value(d.condition, batch.condition ?? 'For assessment'), exchangeFor: stringArray(d.looking_for).join('; '), rewardCredits: Number(value(d.reward_points, 0)), city: value(d.city, batch.location?.city ?? ''), region: value(d.region, batch.location?.region ?? ''),
        status: listingStatusFromDb[d.status as keyof typeof listingStatusFromDb], createdAt: toIso(d.created_at), isDemo: Boolean(d.is_demo),
      };
      break;
    }
    case 'offers': decoded = {
      id: String(d._id), listingId: d.listing_id, listingTitle: value(d.listing_title, d._listing?.title ?? ''), recipientId: d.requester_id, recipientName: value(d.requester_name, d._requester?.name ?? ''),
      providerId: value(d.provider_id, d._listing?.owner_id ?? ''), quantityKg: Number(d.requested_kg), terms: d.terms, offeredCredits: Number(value(d.incentive_points, 0)),
      status: offerStatusFromDb[d.status as keyof typeof offerStatusFromDb], createdAt: toIso(d.created_at), updatedAt: toIso(d.updated_at),
    }; break;
    case 'transfers': {
      const measurements = Array.isArray(d._measurements) ? d._measurements : [];
      const measured = (stage: string) => {
        const compactValue = d[`_${stage}_weight_kg`];
        if (compactValue !== undefined && compactValue !== null) return Number(compactValue);
        return measurements.filter((m: any) => m.stage === stage).sort((a: any, b: any) => +toDate(b.measured_at) - +toDate(a.measured_at))[0]?.weight_kg ?? null;
      };
      decoded = {
        id: String(d._id), listingId: d.listing_id, batchId: d.batch_id, offerId: d.match_request_id, providerId: d.provider_id, recipientId: d.recipient_id,
        materialCategory: value(d.material_category, ''), agreedWeightKg: Number(d.agreed_weight_kg), handoverWeightKg: measured('handover'), receiptWeightKg: measured('receipt'), verifiedWeightKg: measured('validation'),
        status: transferStatusFromDb[d.status as keyof typeof transferStatusFromDb], discrepancyKg: value(d.discrepancy_kg, null), discrepancyReason: value(d.discrepancy_reason, ''), circularOutcome: value(d.circular_outcome, null),
        agreedTerms: d.agreed_terms, pendingRewardCredits: Number(value(d.pending_reward_points, 0)), rewardIssuedAt: nullableIso(d.reward_issued_at), events: (d._flow_events ?? []).map(decodeFlowEvent),
        createdAt: toIso(d.created_at), updatedAt: toIso(d.updated_at), isDemo: Boolean(d.is_demo),
      };
      break;
    }
    case 'recoveryRecords': decoded = {
      id: String(d._id), transferId: d.transfer_id, batchId: d.batch_id, facilityId: d.facility_id, organizationId: d.organization_id, stage: d.stage, inputWeightKg: Number(d.input_kg),
      outputWeightKg: value(d.output_kg, null), residualWeightKg: value(d.rejected_kg, null), outcome: value(d.outcome, null), status: d.status === 'validated' ? 'Validated' : d.status === 'flagged' ? 'Flagged' : d.status === 'reversed' ? 'Reversed' : 'Recorded',
      recordedBy: d.actor_id, validatedBy: value(d.validated_by, null), timestamp: toIso(d.created_at), note: value(d.note, ''), isDemo: Boolean(d.is_demo),
    }; break;
    case 'conversations': decoded = { id: String(d._id), listingId: d.listing_id, listingTitle: value(d._listing?.title, ''), participantIds: stringArray(d.participant_ids), participantNames: stringArray(d.participant_names), updatedAt: toIso(d.updated_at) }; break;
    case 'messages': decoded = { id: String(d._id), conversationId: d.conversation_id, senderId: d.sender_id, senderName: value(d.sender_name, d._sender?.name ?? ''), body: d.body, createdAt: toIso(d.created_at) }; break;
    case 'walletEntries': decoded = { id: String(d._id), userId: d.user_id, transferId: value(d.transfer_id, null), type: ({ earned: 'Earned', redemption: 'Redeemed', reversal: 'Adjustment', adjustment: 'Adjustment' } as Record<string, string>)[d.entry_type], credits: Number(d.points), description: d.title, createdAt: toIso(d.created_at) }; break;
    case 'auditRecords': decoded = { id: String(d._id), actorId: value(d.actor_id, ''), action: d.action, entityType: d.entity_type, entityId: d.entity_id, timestamp: toIso(d.occurred_at), details: value(d.details?.summary, JSON.stringify(d.details)) }; break;
    case 'systemInteractions': decoded = {
      id: String(d._id), userId: value(d.user_id, null), organizationId: value(d.organization_id, null), sessionId: value(d.session_id, null),
      eventName: d.event_name, client: d.client, properties: value(d.properties, { count: 0, synthetic: true }),
      privacyClassification: d.privacy_classification, occurredAt: toIso(d.occurred_at),
    }; break;
    case 'configurations': {
      const v = d.value ?? {};
      decoded = { id: d.key, materialCategories: value(v.materialCategories, []), wasteSources: value(v.wasteSources, []), wasteForms: value(v.wasteForms, []), circularPathways: value(v.circularPathways, []), facilityTypes: value(v.facilityTypes, []), weightStatuses: value(v.weightStatuses, []), discrepancyThresholdPercent: Number(value(v.discrepancyThresholdPercent, 5)), rewardCreditsPerVerifiedKg: Number(value(v.rewardCreditsPerVerifiedKg, 0)), matchingWeights: value(v.matchingWeights, { category: 30, pathway: 15, region: 15, condition: 10, quantity: 10 }), methodologyVersion: value(v.methodologyVersion, 'Not approved'), updatedAt: toIso(d.updated_at), updatedBy: d.updated_by };
      break;
    }
  }
  return decoded as DomainRecord<K>;
}

export function encodeFlowEvent(transferId: string, batchId: string, listingId: string, event: LifecycleEventRecord, sequence: number): Document {
  const stage = ({ 'Offer accepted': 'reserved', Handover: 'handover', Receipt: 'receipt', Validation: 'validation', Completion: 'completion', Cancellation: 'cancellation', Rejection: 'rejection', Dispute: 'dispute' } as Record<string, string>)[event.type];
  return {
    _id: event.id, batch_id: batchId, listing_id: listingId, transfer_id: transferId, actor_id: event.actorId, actor_name: event.actorName, facility_id: null, stage, sequence,
    event_status: event.status === 'Exception' ? 'exception' : 'completed', weight_kg: null, weight_status: null, measurement_id: event.measurementId, location: event.location,
    note: event.note, occurred_at: toDate(event.timestamp), created_at: toDate(event.timestamp),
  };
}

function decodeFlowEvent(document: Document): LifecycleEventRecord {
  const d = document as any;
  const type = ({ reserved: 'Offer accepted', handover: 'Handover', receipt: 'Receipt', validation: 'Validation', completion: 'Completion', cancellation: 'Cancellation', rejection: 'Rejection', dispute: 'Dispute', collection: 'Receipt', processing: 'Validation' } as Record<string, string>)[d.stage] ?? 'Validation';
  return { id: String(d._id ?? d.id), type, actorId: d.actor_id, actorName: value(d.actor_name, ''), timestamp: toIso(d.occurred_at), status: d.event_status === 'exception' ? 'Exception' : 'Completed', location: value(d.location, ''), note: value(d.note, ''), measurementId: value(d.measurement_id, null) } as LifecycleEventRecord;
}
