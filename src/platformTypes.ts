import type { BarterMetrics, CategoryShare, CircularFlowMetrics, EngagementMetrics, Facility, ImpactMetrics, Kpi, RegionActivity, Stakeholder, StakeholderType, Transaction, WastePoint } from './types.js';

export type WeightStatus = 'Estimated' | 'Measured' | 'Verified';
export type CircularPathway = 'Reuse' | 'Repair' | 'Redistribution' | 'Upcycling' | 'Recycling' | 'For assessment';
export type Permission =
  | 'profile.read' | 'profile.update' | 'users.read' | 'users.manage' | 'organizations.read' | 'organizations.manage'
  | 'listings.read' | 'listings.create' | 'listings.match' | 'listings.manage' | 'offers.read' | 'offers.create' | 'offers.manage' | 'batches.read' | 'batches.manage'
  | 'facilities.read' | 'facilities.manage' | 'transfers.read' | 'transfers.manage' | 'recovery.read' | 'recovery.create' | 'recovery.manage'
  | 'analytics.read' | 'analytics.predictive.read' | 'dataQuality.read' | 'audit.read' | 'configuration.read' | 'configuration.manage'
  | 'governance.read' | 'reports.read' | 'reports.export' | 'messages.read' | 'messages.create' | 'wallet.read';

export interface AccessSummary {
  role: StakeholderType;
  permissions: Permission[];
  scope: PlatformUser['scope'];
}

export interface AuthSessionSummary {
  id: string;
  client: 'web' | 'mobile' | 'api';
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
}

export interface PlatformUser {
  id: string;
  email: string;
  fullName: string;
  role: StakeholderType;
  organizationId: string | null;
  organization: string;
  city: string;
  region: string;
  joinedAt: string;
  consentAt: string;
  emailVerifiedAt: string | null;
  passwordChangedAt: string | null;
  verification: 'Demo verified' | 'Pending demo review';
  accountStatus: 'Active' | 'Pending verification' | 'Suspended' | 'Deactivated';
  scope: { organizationIds: string[]; facilityIds: string[]; regions: string[]; canExport: boolean; aggregateOnly: boolean };
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

export interface BarterListing {
  id: string;
  batchId: string;
  ownerId: string;
  ownerOrganizationId: string | null;
  ownerName: string;
  title: string;
  description: string;
  textileType: string;
  wasteSource: 'Pre-consumer' | 'Post-consumer' | 'Obsolete inventory' | 'Household' | 'Institutional' | 'Unknown';
  wasteForm: 'Garments' | 'Offcuts' | 'Fabric rolls' | 'Fiber' | 'Mixed textiles' | 'Other';
  circularPathway: CircularPathway;
  quantityKg: number;
  weightStatus: WeightStatus;
  quality: 'Reusable' | 'Recyclable' | 'For assessment';
  exchangeFor: string;
  rewardCredits: number;
  city: string;
  region: string;
  status: 'Open' | 'Matched' | 'Reserved' | 'Completed' | 'Closed';
  createdAt: string;
  isDemo: boolean;
}

export interface BarterOffer {
  id: string;
  listingId: string;
  listingTitle: string;
  recipientId: string;
  recipientName: string;
  providerId: string;
  quantityKg: number;
  terms: string;
  offeredCredits: number;
  status: 'Pending' | 'Accepted' | 'Declined' | 'Withdrawn';
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  listingId: string;
  listingTitle: string;
  participantIds: string[];
  participantNames: string[];
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface WalletEntry {
  id: string;
  userId: string;
  transferId: string | null;
  type: 'Earned' | 'Redeemed' | 'Adjustment';
  credits: number;
  description: string;
  createdAt: string;
}

export interface LifecycleEvent {
  id: string;
  type: 'Offer accepted' | 'Handover' | 'Receipt' | 'Validation' | 'Completion' | 'Cancellation' | 'Rejection' | 'Dispute';
  actorId: string;
  actorName: string;
  timestamp: string;
  status: 'Completed' | 'Exception';
  location: string;
  note: string;
  measurementId: string | null;
}

export interface Transfer {
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
  status: 'Reserved' | 'Handed over' | 'Received' | 'Validated' | 'Completed' | 'Cancelled' | 'Rejected' | 'Disputed';
  discrepancyKg: number | null;
  discrepancyReason: string;
  circularOutcome: CircularPathway | null;
  agreedTerms: string;
  pendingRewardCredits: number;
  rewardIssuedAt: string | null;
  events: LifecycleEvent[];
  createdAt: string;
  updatedAt: string;
  isDemo: boolean;
}

export interface OperationsAnalytics {
  period: { start: string; end: string; label: string };
  scope: { role: StakeholderType; aggregateOnly: boolean; organizationIds: string[] };
  metrics: { batchCount: number; declaredKg: number; measuredKg: number; verifiedKg: number; receivedKg: number; completedTransfers: number; activeTransfers: number; diversionRate: number; denominator: string };
  massBalance: { declaredKg: number; handedOverKg: number; receivedKg: number; verifiedKg: number; discrepancyKg: number };
  quality: { estimatedBatches: number; measuredBatches: number; verifiedBatches: number; discrepancyFlags: number };
  environmentalImpact: { status: 'Disabled pending approved methodology'; co2eKg: null; waterLiters: null; landfillAvoidedKg: null };
}

export interface DashboardAnalytics {
  metadata: { periodLabel: string; reportingCutoff: string; denominatorNote: string; sampleDisclosure: string; period: import('../shared/reporting.js').ReportingPeriod; aggregateOnly?: boolean };
  kpis: Kpi[];
  wasteTrend: WastePoint[];
  categoryShares: CategoryShare[];
  transactions: Transaction[];
  stakeholders: Stakeholder[];
  facilities: Facility[];
  regionalActivity: RegionActivity[];
  circularFlow: CircularFlowMetrics;
  impactMetrics: ImpactMetrics;
  barterMetrics: BarterMetrics;
  engagementMetrics: EngagementMetrics;
  forecastData: Array<{ month: string; historical: number | null; forecast: number | null }>;
  operations: OperationsAnalytics;
}

export interface Measurement {
  id: string; batchId: string; transferId: string | null; stage: 'Declaration' | 'Handover' | 'Receipt' | 'Validation' | 'Recovery'; weightKg: number; status: WeightStatus; method: string; recordedBy: string; verifiedBy: string | null; timestamp: string; note: string;
}

export interface MaterialBatch {
  id: string; sourceUserId: string; sourceOrganizationId: string | null; materialCategory: string;
  wasteSource: BarterListing['wasteSource']; wasteForm: BarterListing['wasteForm']; condition: BarterListing['quality']; circularPathway: CircularPathway;
  declaredWeightKg: number; currentWeightKg: number; weightStatus: WeightStatus; secondaryQuantity: number | null; secondaryUnit: string | null;
  city: string; region: string; currentStatus: 'Recorded' | 'Listed' | 'Reserved' | 'In transit' | 'Received' | 'Validated' | 'Recovered' | 'Closed' | 'Archived'; archivedAt?: string | null; currentCustodianId: string; createdAt: string; updatedAt: string; isDemo: boolean; measurements: Measurement[];
}

export interface Organization {
  id: string; name: string; type: string; verification: PlatformUser['verification']; recordLabel: 'Demo' | 'Sample'; region: string; city: string;
  status: 'Confirmed demo' | 'Prospective sample' | 'Inactive'; serviceAreas: string[]; acceptedMaterials: string[]; contactEmail: string;
}

export interface PlatformFacility {
  id: string; organizationId: string; name: string; type: 'Collection point' | 'Sorting facility' | 'Recycler' | 'Upcycling hub' | 'Repair hub'; city: string; region: string;
  serviceAreas: string[]; acceptedMaterials: string[]; monthlyCapacityKg: number; currentIntakeKg: number; status: 'Available' | 'Near capacity' | 'Maintenance' | 'Pilot onboarding' | 'Inactive'; verification: PlatformUser['verification']; isDemo: boolean;
}

export interface RecoveryRecord {
  id: string; transferId: string; batchId: string; facilityId: string; organizationId: string; stage: 'Collection' | 'Sorting' | 'Processing' | 'Recovery' | 'Rejection';
  inputWeightKg: number; outputWeightKg: number | null; residualWeightKg: number | null; outcome: CircularPathway | 'Rejected' | null; status: 'Recorded' | 'Validated' | 'Flagged' | 'Reversed';
  recordedBy: string; validatedBy: string | null; timestamp: string; note: string; isDemo: boolean;
}

export interface DataQualityResult {
  thresholdPercent: number; summary: { totalIssues: number; critical: number; warnings: number; validationCoveragePercent: number };
  issues: Array<{ id: string; severity: 'Critical' | 'Warning'; category: string; entityType: string; entityId: string; description: string; status: 'Open' | 'Documented' }>;
}

export interface AuditRecord { id: string; actorId: string; action: string; entityType: string; entityId: string; timestamp: string; details: string }

export interface PlatformConfiguration {
  id: 'platform'; materialCategories: string[]; wasteSources: BarterListing['wasteSource'][]; wasteForms: BarterListing['wasteForm'][]; circularPathways: CircularPathway[]; facilityTypes: PlatformFacility['type'][]; weightStatuses: WeightStatus[];
  discrepancyThresholdPercent: number; rewardCreditsPerVerifiedKg: number; matchingWeights: { category: number; pathway: number; region: number; condition: number; quantity: number }; methodologyVersion: string; updatedAt: string; updatedBy: string;
}

export interface GovernanceData {
  methodology: { environmentalImpact: string; predictiveAnalytics: string; prescriptiveAnalytics: string; massAccounting: string; version: string };
  privacy: { role: StakeholderType; aggregateOnly: boolean; exportAllowed: boolean; policy: string };
  policyIndicators: Array<{ label: string; status: string; caveat: string }>;
}

export interface ReportDefinition { id: string; name: string; description: string; formats: string[]; available: boolean }
