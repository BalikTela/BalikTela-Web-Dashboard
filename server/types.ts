export type UserRole =
  | 'Administrator'
  | 'Government'
  | 'Researcher'
  | 'Producer'
  | 'Recycler'
  | 'BalikTela Hub'
  | 'Consumer'
  | 'NGO'
  | 'LGU/Collection Point'
  | 'Upcycler';

export type VerificationStatus = 'Demo verified' | 'Pending demo review';
export type WeightStatus = 'Estimated' | 'Measured' | 'Verified';
export type CircularPathway = typeof import('../shared/workflows.js').CIRCULAR_PATHWAYS[number];
export type { ListingStatus, OfferStatus, TransferStatus } from '../shared/workflows.js';
import type { ListingStatus, OfferStatus, TransferStatus } from '../shared/workflows.js';

export interface AccessScope {
  organizationIds: string[];
  facilityIds: string[];
  regions: string[];
  canExport: boolean;
  aggregateOnly: boolean;
}

export interface UserRecord {
  id: string;
  authUserId: string | null;
  email: string;
  passwordHash: string | null;
  fullName: string;
  role: UserRole;
  organizationId: string | null;
  organization: string;
  city: string;
  region: string;
  joinedAt: string;
  consentAt: string;
  emailVerifiedAt: string | null;
  passwordChangedAt: string | null;
  verification: VerificationStatus;
  canonicalVerification?: string;
  organizationVerified?: boolean;
  stakeholder?: string;
  webHubOperator?: boolean;
  location?: string;
  accountStatus: 'Active' | 'Pending verification' | 'Suspended' | 'Deactivated';
  scope: AccessScope;
  trustPlaceholder: number;
  profile: {
    ageGroup: string;
    organizationSize: string;
    productionVolumeKg: number;
    recyclingPractices: string;
    acceptedTextiles: string[];
    sustainabilityInterests: string[];
  };
}

export interface OrganizationRecord {
  id: string;
  name: string;
  type: string;
  verification: VerificationStatus;
  recordLabel: 'Demo' | 'Sample';
  region: string;
  city: string;
  status: 'Confirmed demo' | 'Prospective sample' | 'Inactive';
  serviceAreas: string[];
  acceptedMaterials: string[];
  contactEmail: string;
}

export interface FacilityRecord {
  id: string;
  organizationId: string;
  name: string;
  type: 'Collection point' | 'Sorting facility' | 'Recycler' | 'Upcycling hub' | 'Repair hub';
  city: string;
  region: string;
  serviceAreas: string[];
  acceptedMaterials: string[];
  monthlyCapacityKg: number;
  currentIntakeKg: number;
  status: 'Available' | 'Near capacity' | 'Maintenance' | 'Pilot onboarding' | 'Inactive';
  verification: VerificationStatus;
  isDemo: boolean;
}

export interface MaterialBatchRecord {
  id: string;
  sourceUserId: string;
  sourceOrganizationId: string | null;
  materialCategory: string;
  wasteSource: 'Pre-consumer' | 'Post-consumer' | 'Obsolete inventory' | 'Household' | 'Institutional' | 'Unknown';
  wasteForm: 'Garments' | 'Offcuts' | 'Fabric rolls' | 'Fiber' | 'Mixed textiles' | 'Other';
  condition: typeof import('../shared/workflows.js').MATERIAL_CONDITIONS[number];
  circularPathway: CircularPathway;
  declaredWeightKg: number | null;
  currentWeightKg: number | null;
  weightStatus: WeightStatus | null;
  secondaryQuantity: number | null;
  secondaryUnit: string | null;
  city: string;
  region: string;
  currentStatus: import('../shared/workflows.js').BatchStatus;
  canonicalStatus?: string;
  archivedAt?: string | null;
  currentCustodianId: string;
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
}

export interface MeasurementRecord {
  id: string;
  batchId: string;
  transferId: string | null;
  stage: 'Declaration' | 'Handover' | 'Receipt' | 'Validation' | 'Recovery';
  weightKg: number;
  status: WeightStatus;
  method: string;
  recordedBy: string;
  verifiedBy: string | null;
  timestamp: string;
  note: string;
  canonicalStage?: import('../shared/hubs.js').CanonicalMeasurementStage;
  facilityId?: string | null;
  supersedesMeasurementId?: string | null;
}

export interface ListingRecord {
  id: string;
  batchId: string;
  ownerId: string;
  ownerOrganizationId: string | null;
  ownerName: string;
  title: string;
  description: string;
  textileType: string;
  wasteSource: MaterialBatchRecord['wasteSource'];
  wasteForm: MaterialBatchRecord['wasteForm'];
  circularPathway: CircularPathway;
  quantityKg: number | null;
  weightStatus: WeightStatus | null;
  availableWeightKg?: number | null;
  reservedKg?: number;
  weighingHubId?: string | null;
  deliveryRoute?: 'direct' | 'via_hub' | null;
  canonicalStatus?: string;
  disposedAt?: string | null;
  remainderPending?: boolean;
  disposedWeightKg?: number;
  remainderOfId?: string | null;
  quality: MaterialBatchRecord['condition'];
  exchangeFor: string;
  rewardCredits: number;
  city: string;
  region: string;
  status: ListingStatus;
  createdAt: string;
  isDemo: boolean;
}

export interface OfferRecord {
  id: string;
  listingId: string;
  listingTitle: string;
  recipientId: string;
  recipientName: string;
  providerId: string;
  quantityKg: number;
  terms: string;
  offeredCredits: number;
  status: OfferStatus;
  canonicalStatus?: string;
  version?: number;
  previousTerms?: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface LifecycleEventRecord {
  id: string;
  type: 'Offer accepted' | 'Handover' | 'Receipt' | 'Validation' | 'Completion' | 'Cancellation' | 'Rejection' | 'Dispute' | 'Collection' | 'Processing' | 'Activity';
  canonicalStage?: string;
  weightKg?: number | null;
  weightStatus?: WeightStatus | null;
  actorId: string;
  actorName: string;
  timestamp: string;
  status: 'Completed' | 'Exception';
  location: string;
  note: string;
  measurementId: string | null;
}

export interface TransferRecord {
  id: string;
  listingId: string;
  batchId: string;
  offerId: string;
  providerId: string;
  recipientId: string;
  materialCategory: string;
  agreedWeightKg: number;
  handoverWeightKg: number | null;
  receiptWeightKg: number | null;
  verifiedWeightKg: number | null;
  status: TransferStatus;
  canonicalStatus?: string;
  discrepancyKg: number | null;
  discrepancyReason: string;
  circularOutcome: CircularPathway | null;
  agreedTerms: string;
  pendingRewardCredits: number;
  rewardIssuedAt: string | null;
  events: LifecycleEventRecord[];
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
}

export interface ConversationRecord {
  id: string;
  listingId: string;
  listingTitle: string;
  participantIds: string[];
  participantNames: string[];
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface WalletEntryRecord {
  id: string;
  userId: string;
  transferId: string | null;
  type: 'Earned' | 'Redeemed' | 'Adjustment';
  credits: number;
  description: string;
  createdAt: string;
}

export interface AuditRecord {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  timestamp: string;
  details: string;
}

export interface SystemInteractionRecord {
  id: string;
  userId: string | null;
  organizationId: string | null;
  sessionId: string | null;
  eventName: 'active_users' | 'sessions' | 'waste_submissions' | 'barter_actions' | 'report_exports';
  client: 'web' | 'mobile';
  properties: { count: number; averageSessionMinutes?: number; region?: string; city?: string; synthetic: true };
  privacyClassification: 'aggregate' | 'pseudonymized' | 'restricted';
  occurredAt: string;
}

export interface RecoveryRecord {
  id: string;
  transferId: string;
  batchId: string;
  facilityId: string;
  organizationId: string;
  stage: 'Collection' | 'Sorting' | 'Processing' | 'Recovery' | 'Rejection';
  inputWeightKg: number;
  outputWeightKg: number | null;
  residualWeightKg: number | null;
  lossWeightKg?: number;
  outcome: CircularPathway | 'Rejected' | null;
  status: 'Recorded' | 'Validated' | 'Flagged' | 'Reversed';
  recordedBy: string;
  validatedBy: string | null;
  timestamp: string;
  note: string;
  isDemo: boolean;
}

export interface ConfigurationRecord {
  id: 'platform';
  materialCategories: string[];
  wasteSources: MaterialBatchRecord['wasteSource'][];
  wasteForms: MaterialBatchRecord['wasteForm'][];
  circularPathways: CircularPathway[];
  facilityTypes: FacilityRecord['type'][];
  weightStatuses: WeightStatus[];
  discrepancyThresholdPercent: number;
  rewardCreditsPerVerifiedKg: number;
  matchingWeights: { category: number; pathway: number; region: number; condition: number; quantity: number };
  methodologyVersion: string;
  updatedAt: string;
  updatedBy: string;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  client: 'web' | 'mobile' | 'api';
  tokenHash: string;
  usedTokenHashes: string[];
  csrfHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthChallengeRecord {
  id: string;
  userId: string;
  type: 'password_reset' | 'email_verification';
  tokenHash: string;
  client: 'web' | 'mobile' | 'api';
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthRateLimitRecord {
  id: string;
  scope: 'login' | 'password_reset' | 'email_verification';
  subjectHash: string;
  attempts: number;
  windowStartedAt: string;
  lockedUntil: string | null;
  expiresAt: string;
  updatedAt: string;
}

export interface DatabaseShape {
  users: UserRecord[];
  organizations: OrganizationRecord[];
  facilities: FacilityRecord[];
  materialBatches: MaterialBatchRecord[];
  measurements: MeasurementRecord[];
  listings: ListingRecord[];
  offers: OfferRecord[];
  transfers: TransferRecord[];
  recoveryRecords: RecoveryRecord[];
  conversations: ConversationRecord[];
  messages: MessageRecord[];
  walletEntries: WalletEntryRecord[];
  auditRecords: AuditRecord[];
  systemInteractions: SystemInteractionRecord[];
  configurations: ConfigurationRecord[];
}
