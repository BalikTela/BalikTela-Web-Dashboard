import bcrypt from 'bcryptjs';
import type { DatabaseShape, ListingRecord, MaterialBatchRecord, UserRecord } from './types.js';

const now = '2026-09-21T08:00:00.000Z';

function user(overrides: Partial<UserRecord> & Pick<UserRecord, 'id' | 'email' | 'fullName' | 'role' | 'organization' | 'organizationId' | 'city' | 'region'>, passwordHash: string): UserRecord {
  const organizationIds = overrides.organizationId ? [overrides.organizationId] : [];
  return {
    authUserId: null,
    passwordHash,
    joinedAt: '2026-07-01T08:00:00.000Z',
    consentAt: '2026-07-01T08:00:00.000Z',
    emailVerifiedAt: '2026-07-01T08:00:00.000Z',
    passwordChangedAt: '2026-07-01T08:00:00.000Z',
    verification: 'Demo verified',
    accountStatus: 'Active',
    scope: { organizationIds, facilityIds: [], regions: [overrides.region], canExport: false, aggregateOnly: false },
    trustPlaceholder: 82,
    profile: { ageGroup: 'Not specified', organizationSize: 'Medium', productionVolumeKg: 0, recyclingPractices: '', acceptedTextiles: [], sustainabilityInterests: ['Textile reuse', 'Waste diversion'] },
    ...overrides,
  };
}

const listingSeeds: Array<Omit<ListingRecord, 'batchId'>> = [
  { id: 'LST-2609-001', ownerId: 'USR-PROD-01', ownerOrganizationId: 'ORG-PROD-01', ownerName: 'Metro Apparel Demo Producer', title: 'Cotton offcuts from sample production run', description: 'Clean, sorted cotton offcuts packed in labeled sacks for reuse or fiber recovery.', textileType: 'Cotton', wasteSource: 'Pre-consumer', wasteForm: 'Offcuts', circularPathway: 'Recycling', quantityKg: 320, weightStatus: 'Measured', quality: 'Recyclable', exchangeFor: 'Processing service or equivalent reward credits', rewardCredits: 640, city: 'Makati', region: 'Metro Manila', status: 'Open', createdAt: '2026-09-20T02:15:00.000Z', isDemo: true },
  { id: 'LST-2609-002', ownerId: 'USR-CONS-01', ownerOrganizationId: null, ownerName: 'Demo Consumer Participant', title: 'Reusable denim garments', description: 'Washed adult denim garments suitable for repair or community redistribution.', textileType: 'Denim', wasteSource: 'Household', wasteForm: 'Garments', circularPathway: 'Reuse', quantityKg: 18, weightStatus: 'Estimated', quality: 'Reusable', exchangeFor: 'Community credits or repair voucher', rewardCredits: 36, city: 'Quezon City', region: 'Metro Manila', status: 'Matched', createdAt: '2026-09-18T05:40:00.000Z', isDemo: true },
  { id: 'LST-2609-003', ownerId: 'USR-REC-01', ownerOrganizationId: 'ORG-REC-01', ownerName: 'Green Loop Demo Cooperative', title: 'Recovered mixed-fiber bundles', description: 'Pre-sorted bundles available for product-development trials and material testing.', textileType: 'Mixed fabric', wasteSource: 'Institutional', wasteForm: 'Mixed textiles', circularPathway: 'Upcycling', quantityKg: 145, weightStatus: 'Verified', quality: 'For assessment', exchangeFor: 'Research collaboration or transport support', rewardCredits: 290, city: 'Quezon City', region: 'Metro Manila', status: 'Open', createdAt: '2026-09-17T01:20:00.000Z', isDemo: true },
  { id: 'LST-2609-004', ownerId: 'USR-PROD-01', ownerOrganizationId: 'ORG-PROD-01', ownerName: 'Metro Apparel Demo Producer', title: 'Obsolete uniform inventory', description: 'Unused sample uniforms with minor branding defects, suitable for redistribution or redesign.', textileType: 'Uniforms', wasteSource: 'Obsolete inventory', wasteForm: 'Garments', circularPathway: 'Redistribution', quantityKg: 92, weightStatus: 'Measured', quality: 'Reusable', exchangeFor: 'Validated donation receipt and collection service', rewardCredits: 184, city: 'Makati', region: 'Metro Manila', status: 'Completed', createdAt: '2026-09-10T07:10:00.000Z', isDemo: true },
];

function batchFor(listing: Omit<ListingRecord, 'batchId'>): MaterialBatchRecord {
  return {
    id: listing.id.replace('LST', 'MB'), sourceUserId: listing.ownerId, sourceOrganizationId: listing.ownerOrganizationId,
    materialCategory: listing.textileType, wasteSource: listing.wasteSource, wasteForm: listing.wasteForm,
    condition: listing.quality, circularPathway: listing.circularPathway, declaredWeightKg: listing.quantityKg,
    currentWeightKg: listing.id === 'LST-2609-004' ? 89 : listing.quantityKg,
    weightStatus: listing.id === 'LST-2609-004' ? 'Verified' : listing.weightStatus,
    secondaryQuantity: null, secondaryUnit: null, city: listing.city, region: listing.region,
    currentStatus: listing.id === 'LST-2609-004' ? 'Recovered' : listing.status === 'Matched' ? 'Listed' : 'Listed',
    currentCustodianId: listing.id === 'LST-2609-004' ? 'USR-REC-01' : listing.ownerId,
    createdAt: listing.createdAt, updatedAt: listing.id === 'LST-2609-004' ? '2026-09-15T08:30:00.000Z' : listing.createdAt, isDemo: true,
  };
}

export async function createSeedData(): Promise<DatabaseShape> {
  const passwordHash = await bcrypt.hash('BalikTelaDemo2026!', 10);
  const users = [
    user({ id: 'USR-ADMIN-01', email: 'admin@baliktela.demo', fullName: 'Demo Administrator', role: 'Administrator', organizationId: 'ORG-BT-01', organization: 'BalikTela Research Team (demo)', city: 'Manila', region: 'Metro Manila', scope: { organizationIds: [], facilityIds: [], regions: [], canExport: true, aggregateOnly: false } }, passwordHash),
    user({ id: 'USR-GOV-01', email: 'government@baliktela.demo', fullName: 'Demo Policy Officer', role: 'Government', organizationId: 'ORG-GOV-01', organization: 'Government Policy Office (sample)', city: 'Manila', region: 'Metro Manila', scope: { organizationIds: [], facilityIds: [], regions: ['Metro Manila'], canExport: true, aggregateOnly: true } }, passwordHash),
    user({ id: 'USR-RESEARCH-01', email: 'researcher@baliktela.demo', fullName: 'Dr. Elena Cruz', role: 'Researcher', organizationId: 'ORG-RES-01', organization: 'Circular Textiles Research Unit (sample)', city: 'Manila', region: 'Metro Manila', scope: { organizationIds: [], facilityIds: [], regions: [], canExport: true, aggregateOnly: true } }, passwordHash),
    user({ id: 'USR-PROD-01', email: 'producer@baliktela.demo', fullName: 'Maya Santos', role: 'Producer', organizationId: 'ORG-PROD-01', organization: 'Metro Apparel Demo Producer', city: 'Makati', region: 'Metro Manila', profile: { ageGroup: '35-44', organizationSize: 'Large', productionVolumeKg: 18400, recyclingPractices: 'Post-consumer collection and obsolete stock recovery pilot.', acceptedTextiles: ['Cotton', 'Denim', 'Mixed fabric'], sustainabilityInterests: ['EPR readiness', 'Post-consumer returns'] } }, passwordHash),
    user({ id: 'USR-REC-01', email: 'recycler@baliktela.demo', fullName: 'Lino Reyes', role: 'Recycler', organizationId: 'ORG-REC-01', organization: 'Green Loop Demo Cooperative', city: 'Quezon City', region: 'Metro Manila', profile: { ageGroup: '45-54', organizationSize: 'Small', productionVolumeKg: 0, recyclingPractices: 'Fiber sorting, mechanical recycling, and reusable material recovery.', acceptedTextiles: ['Cotton', 'Polyester', 'Denim', 'Mixed fabric'], sustainabilityInterests: ['Material recovery', 'Capacity planning'] } }, passwordHash),
    user({ id: 'USR-CONS-01', email: 'consumer@baliktela.demo', fullName: 'Ana Dela Cruz', role: 'Consumer', organizationId: null, organization: 'Individual participant (demo)', city: 'Quezon City', region: 'Metro Manila', profile: { ageGroup: '25-34', organizationSize: 'Individual', productionVolumeKg: 0, recyclingPractices: 'Community donation and clothing swap participation.', acceptedTextiles: [], sustainabilityInterests: ['Clothing swaps', 'Repair and reuse'] } }, passwordHash),
  ];
  const materialBatches = listingSeeds.map(batchFor);
  const listings = listingSeeds.map((listing) => ({ ...listing, batchId: listing.id.replace('LST', 'MB') }));

  return {
    users,
    organizations: [
      { id: 'ORG-BT-01', name: 'BalikTela Research Team (demo)', type: 'Research', verification: 'Demo verified', recordLabel: 'Demo', region: 'Metro Manila', city: 'Manila', status: 'Confirmed demo', serviceAreas: ['National demo scope'], acceptedMaterials: [], contactEmail: 'admin@baliktela.demo' },
      { id: 'ORG-GOV-01', name: 'Government Policy Office (sample)', type: 'Government', verification: 'Demo verified', recordLabel: 'Sample', region: 'Metro Manila', city: 'Manila', status: 'Prospective sample', serviceAreas: ['Metro Manila'], acceptedMaterials: [], contactEmail: 'government@baliktela.demo' },
      { id: 'ORG-RES-01', name: 'Circular Textiles Research Unit (sample)', type: 'Research', verification: 'Demo verified', recordLabel: 'Sample', region: 'Metro Manila', city: 'Manila', status: 'Prospective sample', serviceAreas: ['National sample dataset'], acceptedMaterials: ['Cotton', 'Polyester', 'Denim', 'Mixed fabric'], contactEmail: 'researcher@baliktela.demo' },
      { id: 'ORG-PROD-01', name: 'Metro Apparel Demo Producer', type: 'Producer', verification: 'Demo verified', recordLabel: 'Demo', region: 'Metro Manila', city: 'Makati', status: 'Confirmed demo', serviceAreas: ['Makati', 'Manila'], acceptedMaterials: ['Cotton', 'Denim', 'Uniforms'], contactEmail: 'producer@baliktela.demo' },
      { id: 'ORG-REC-01', name: 'Green Loop Demo Cooperative', type: 'Recycler', verification: 'Demo verified', recordLabel: 'Demo', region: 'Metro Manila', city: 'Quezon City', status: 'Confirmed demo', serviceAreas: ['Quezon City', 'Manila', 'Makati'], acceptedMaterials: ['Cotton', 'Polyester', 'Denim', 'Mixed fabric', 'Uniforms'], contactEmail: 'recycler@baliktela.demo' },
    ],
    facilities: [
      { id: 'FAC-001', organizationId: 'ORG-REC-01', name: 'Green Loop Sorting Hub (demo)', type: 'Sorting facility', city: 'Quezon City', region: 'Metro Manila', serviceAreas: ['Quezon City', 'Manila'], acceptedMaterials: ['Cotton', 'Polyester', 'Denim', 'Mixed fabric', 'Uniforms'], monthlyCapacityKg: 2400, currentIntakeKg: 1130, status: 'Available', verification: 'Demo verified', isDemo: true },
      { id: 'FAC-002', organizationId: 'ORG-REC-01', name: 'Green Loop Recovery Line (demo)', type: 'Recycler', city: 'Quezon City', region: 'Metro Manila', serviceAreas: ['Metro Manila'], acceptedMaterials: ['Cotton', 'Polyester', 'Denim', 'Mixed fabric'], monthlyCapacityKg: 1800, currentIntakeKg: 1375, status: 'Available', verification: 'Demo verified', isDemo: true },
      { id: 'FAC-003', organizationId: 'ORG-PROD-01', name: 'Makati Textile Return Desk (demo)', type: 'Collection point', city: 'Makati', region: 'Metro Manila', serviceAreas: ['Makati'], acceptedMaterials: ['Cotton', 'Denim', 'Uniforms'], monthlyCapacityKg: 600, currentIntakeKg: 492, status: 'Near capacity', verification: 'Demo verified', isDemo: true },
    ],
    materialBatches,
    measurements: [
      ...materialBatches.filter(batch => batch.declaredWeightKg !== null).map((batch) => ({ id: `MSR-${batch.id}-DECL`, batchId: batch.id, transferId: null, stage: 'Declaration' as const, weightKg: batch.declaredWeightKg!, status: batch.id === 'MB-2609-002' ? 'Estimated' as const : 'Measured' as const, method: batch.id === 'MB-2609-002' ? 'Participant estimate' : 'Platform scale', recordedBy: batch.sourceUserId, verifiedBy: null, timestamp: batch.createdAt, note: 'Initial sample batch measurement.' })),
      { id: 'MSR-MB-2609-004-HO', batchId: 'MB-2609-004', transferId: 'TRF-2609-001', stage: 'Handover', weightKg: 91, status: 'Measured', method: 'Collection point scale', recordedBy: 'USR-PROD-01', verifiedBy: null, timestamp: '2026-09-13T08:00:00.000Z', note: 'Handover weight.' },
      { id: 'MSR-MB-2609-004-RC', batchId: 'MB-2609-004', transferId: 'TRF-2609-001', stage: 'Receipt', weightKg: 89, status: 'Measured', method: 'Receiving facility scale', recordedBy: 'USR-REC-01', verifiedBy: null, timestamp: '2026-09-14T08:00:00.000Z', note: '2 kg variance recorded.' },
      { id: 'MSR-MB-2609-004-VF', batchId: 'MB-2609-004', transferId: 'TRF-2609-001', stage: 'Validation', weightKg: 89, status: 'Verified', method: 'Facility validation', recordedBy: 'USR-REC-01', verifiedBy: 'USR-REC-01', timestamp: '2026-09-14T09:00:00.000Z', note: 'Verified reusable quantity.' },
    ],
    listings,
    offers: [
      { id: 'OFR-2609-001', listingId: 'LST-2609-002', listingTitle: 'Reusable denim garments', recipientId: 'USR-REC-01', recipientName: 'Green Loop Demo Cooperative', providerId: 'USR-CONS-01', quantityKg: 18, terms: 'Pickup within three working days; validate reusable pieces on receipt.', offeredCredits: 36, status: 'Pending', createdAt: '2026-09-19T03:30:00.000Z', updatedAt: '2026-09-19T03:30:00.000Z' },
      { id: 'OFR-2609-002', listingId: 'LST-2609-004', listingTitle: 'Obsolete uniform inventory', recipientId: 'USR-REC-01', recipientName: 'Green Loop Demo Cooperative', providerId: 'USR-PROD-01', quantityKg: 92, terms: 'Collect, verify, and redirect reusable uniforms.', offeredCredits: 184, status: 'Accepted', createdAt: '2026-09-11T03:30:00.000Z', updatedAt: '2026-09-12T03:30:00.000Z' },
    ],
    transfers: [{ id: 'TRF-2609-001', listingId: 'LST-2609-004', batchId: 'MB-2609-004', offerId: 'OFR-2609-002', providerId: 'USR-PROD-01', recipientId: 'USR-REC-01', materialCategory: 'Uniforms', agreedWeightKg: 92, handoverWeightKg: 91, receiptWeightKg: 89, verifiedWeightKg: 89, status: 'Completed', discrepancyKg: -2, discrepancyReason: 'Packaging and non-textile accessories excluded at receipt.', circularOutcome: 'Redistribution', agreedTerms: 'Collect, verify, and redirect reusable uniforms.', pendingRewardCredits: 178, rewardIssuedAt: '2026-09-15T08:30:00.000Z', createdAt: '2026-09-12T03:30:00.000Z', updatedAt: '2026-09-15T08:30:00.000Z', isDemo: true, events: [
      { id: 'EVT-001', type: 'Offer accepted', actorId: 'USR-PROD-01', actorName: 'Metro Apparel Demo Producer', timestamp: '2026-09-12T03:30:00.000Z', status: 'Completed', location: 'Makati, Metro Manila', note: 'Transfer reserved; no recovery or reward recorded yet.', measurementId: null },
      { id: 'EVT-002', type: 'Handover', actorId: 'USR-PROD-01', actorName: 'Metro Apparel Demo Producer', timestamp: '2026-09-13T08:00:00.000Z', status: 'Completed', location: 'Makati, Metro Manila', note: '91 kg handed over.', measurementId: 'MSR-MB-2609-004-HO' },
      { id: 'EVT-003', type: 'Receipt', actorId: 'USR-REC-01', actorName: 'Green Loop Demo Cooperative', timestamp: '2026-09-14T08:00:00.000Z', status: 'Completed', location: 'Quezon City, Metro Manila', note: '89 kg received; discrepancy documented.', measurementId: 'MSR-MB-2609-004-RC' },
      { id: 'EVT-004', type: 'Validation', actorId: 'USR-REC-01', actorName: 'Green Loop Demo Cooperative', timestamp: '2026-09-14T09:00:00.000Z', status: 'Completed', location: 'Quezon City, Metro Manila', note: '89 kg verified for redistribution.', measurementId: 'MSR-MB-2609-004-VF' },
      { id: 'EVT-005', type: 'Completion', actorId: 'USR-REC-01', actorName: 'Green Loop Demo Cooperative', timestamp: '2026-09-15T08:30:00.000Z', status: 'Completed', location: 'Quezon City, Metro Manila', note: 'Validated transfer completed and reward released.', measurementId: null },
    ] }],
    recoveryRecords: [
      { id: 'RCV-001', transferId: 'TRF-2609-001', batchId: 'MB-2609-004', facilityId: 'FAC-001', organizationId: 'ORG-REC-01', stage: 'Sorting', inputWeightKg: 89, outputWeightKg: 86, residualWeightKg: 3, outcome: 'Redistribution', status: 'Validated', recordedBy: 'USR-REC-01', validatedBy: 'USR-REC-01', timestamp: '2026-09-14T10:00:00.000Z', note: 'Non-textile fasteners and damaged pieces separated.', isDemo: true },
      { id: 'RCV-002', transferId: 'TRF-2609-001', batchId: 'MB-2609-004', facilityId: 'FAC-001', organizationId: 'ORG-REC-01', stage: 'Recovery', inputWeightKg: 86, outputWeightKg: 86, residualWeightKg: 0, outcome: 'Redistribution', status: 'Validated', recordedBy: 'USR-REC-01', validatedBy: 'USR-REC-01', timestamp: '2026-09-15T08:00:00.000Z', note: 'Reusable uniforms released to a sample redistribution pathway.', isDemo: true },
    ],
    conversations: [{ id: 'CNV-2609-001', listingId: 'LST-2609-002', listingTitle: 'Reusable denim garments', participantIds: ['USR-CONS-01', 'USR-REC-01'], participantNames: ['Ana Dela Cruz', 'Green Loop Demo Cooperative'], updatedAt: now }],
    messages: [
      { id: 'MSG-001', conversationId: 'CNV-2609-001', senderId: 'USR-REC-01', senderName: 'Green Loop Demo Cooperative', body: 'Can the garments be collected together in one labeled package?', createdAt: '2026-09-19T03:35:00.000Z' },
      { id: 'MSG-002', conversationId: 'CNV-2609-001', senderId: 'USR-CONS-01', senderName: 'Ana Dela Cruz', body: 'Yes. I can prepare the package and item count before pickup.', createdAt: '2026-09-19T04:05:00.000Z' },
    ],
    walletEntries: [
      { id: 'WLT-001', userId: 'USR-ADMIN-01', transferId: null, type: 'Adjustment', credits: 1200, description: 'Demo workspace opening balance', createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'WLT-002', userId: 'USR-PROD-01', transferId: 'TRF-2609-001', type: 'Earned', credits: 178, description: 'Validated completion: 89 kg obsolete uniform inventory at 2 credits/kg', createdAt: '2026-09-15T08:30:00.000Z' },
    ],
    auditRecords: [{ id: 'AUD-001', actorId: 'USR-REC-01', action: 'transfer.completed', entityType: 'Transfer', entityId: 'TRF-2609-001', timestamp: '2026-09-15T08:30:00.000Z', details: 'Validated 89 kg redistribution; 178 demo credits released at configured 2 credits/kg.' }],
    systemInteractions: [],
    configurations: [{ id: 'platform', materialCategories: ['Cotton', 'Polyester', 'Denim', 'Mixed fabric', 'Uniforms', 'Household linen'], wasteSources: ['Pre-consumer', 'Post-consumer', 'Obsolete inventory', 'Household', 'Institutional', 'Unknown'], wasteForms: ['Garments', 'Offcuts', 'Fabric rolls', 'Fiber', 'Mixed textiles', 'Other'], circularPathways: ['Reuse', 'Repair', 'Redistribution', 'Upcycling', 'Recycling', 'For assessment'], facilityTypes: ['Collection point', 'Sorting facility', 'Recycler', 'Upcycling hub', 'Repair hub'], weightStatuses: ['Estimated', 'Measured', 'Verified'], discrepancyThresholdPercent: 5, rewardCreditsPerVerifiedKg: 2, matchingWeights: { category: 30, pathway: 15, region: 15, condition: 10, quantity: 10 }, methodologyVersion: 'Environmental methodology not approved', updatedAt: '2026-09-21T08:00:00.000Z', updatedBy: 'USR-ADMIN-01' }],
  };
}
