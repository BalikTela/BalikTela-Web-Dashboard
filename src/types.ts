export type Region =
  | 'All regions'
  | 'Metro Manila'
  | 'Central Visayas'
  | 'Western Visayas'
  | 'Davao Region';

export type TextileType = 'Cotton' | 'Polyester' | 'Denim' | 'Mixed fabric' | 'Uniforms' | 'Household linen';
export type TransactionType = 'Barter' | 'Return' | 'Donation' | 'Collection' | 'Recycling' | 'Redistribution';
export type TransactionStatus = 'Completed' | 'In sorting' | 'In transit' | 'Pending validation' | 'Flagged';
export type StakeholderType = 'Producer' | 'Recycler' | 'Consumer' | 'NGO' | 'Administrator' | 'Government' | 'Researcher' | 'LGU/Collection Point' | 'Upcycler';

export interface Filters {
  dateRange: string;
  region: Region;
  city: string;
  textileType: 'All textiles' | TextileType;
  transactionType: 'All types' | TransactionType;
  stakeholderType: 'All stakeholders' | StakeholderType;
  producer: string;
  recycler: string;
  wasteSource: 'All sources' | 'Pre-consumer' | 'Post-consumer' | 'Obsolete inventory' | 'Household' | 'Institutional' | 'Unknown';
  circularPathway: 'All pathways' | 'Reuse' | 'Repair' | 'Redistribution' | 'Upcycling' | 'Recycling' | 'For assessment';
  weightStatus: 'All weight statuses' | 'Estimated' | 'Measured' | 'Verified';
  facilityId: string;
  organizationId: string;
  transactionStatus: string;
}

export interface Kpi {
  label: string;
  value: string;
  delta: string;
  tone: 'moss' | 'ocean' | 'clay' | 'denim';
}

export interface WastePoint {
  month: string;
  recorded: number;
  collected: number;
  recycled: number;
  reused: number;
}

export interface WasteRecord {
  id: string;
  month: string;
  monthIndex: number;
  date: string;
  region: Exclude<Region, 'All regions'>;
  city: string;
  textileType: TextileType;
  transactionType: TransactionType;
  stakeholderType: Exclude<StakeholderType, 'Administrator'>;
  producer: string;
  recycler: string;
  generatedKg: number;
  collectedKg: number;
  sortedKg: number;
  reusedKg: number;
  recycledKg: number;
  transactionCount: number;
}

export interface CategoryShare {
  category: TextileType;
  kilograms: number;
  recoveryRate: number;
}

export interface Transaction {
  id: string;
  date: string;
  source: string;
  destination: string;
  type: TransactionType;
  textileCategory: TextileType;
  weightKg: number;
  location: string;
  region: Exclude<Region, 'All regions'>;
  status: TransactionStatus;
  impact: string;
  estimatedImpactKg?: number;
  sourceStakeholderId?: string;
  destinationStakeholderId?: string;
  lifecycle: LifecycleEvent[];
  isDemo: true;
}

export interface LifecycleEvent {
  id: string;
  stage: string;
  actor: string;
  timestamp: string | null;
  status: 'Completed' | 'Current' | 'Pending' | 'Exception';
  location: string;
  note: string;
}

export interface Stakeholder {
  id: string;
  name: string;
  type: StakeholderType;
  city: string;
  region: Exclude<Region, 'All regions'>;
  recoveredKg: number;
  generatedKg: number;
  capacityKg?: number;
  utilization?: number;
  participation: number;
  transactions: number;
  verification: 'Demo verified' | 'Pending demo review';
  reliabilityPlaceholder: number;
  sustainabilityActivities: string[];
  joinedAt: string;
  isDemo: true;
}

export interface Facility {
  id: string;
  name: string;
  location: string;
  region: Exclude<Region, 'All regions'>;
  acceptedTypes: TextileType[];
  capacityKg: number;
  utilization: number;
  intakeKg: number;
  processedKg: number;
  processingTimeDays: number;
  status: 'Available' | 'Near capacity' | 'Maintenance' | 'Pilot onboarding';
  isDemo: true;
}

export interface RegionActivity {
  region: Exclude<Region, 'All regions'>;
  city: string;
  collectionKg: number;
  recyclingKg: number;
  wasteGapKg: number;
  producers: number;
  collectionPoints: number;
  recyclers: number;
  x: number;
  y: number;
}

export interface CircularFlowMetrics {
  generatedKg: number;
  collectedKg: number;
  sortedKg: number;
  reusedKg: number;
  recycledKg: number;
  residualKg: number;
}

export interface ImpactMetrics {
  landfillAvoidedKg: number | null;
  estimatedCo2eKg: number | null;
  estimatedWaterLiters: number | null;
  diversionRate: number;
  sortingYield: number;
  methodologyStatus: 'Disabled pending approved methodology';
}

export interface BarterMetrics {
  listings: number;
  matches: number;
  validated: number;
  completed: number;
  rewardCredits: number;
}

export interface EngagementMetrics {
  monthlyActiveUsers: number;
  sessions: number;
  wasteSubmissions: number;
  barterActions: number;
  reportExports: number;
  averageSessionMinutes: number;
}
