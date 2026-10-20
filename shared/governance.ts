export interface PolicyMetrics {
  batches: number;
  declaredKg: number;
  collectedKg: number | null;
  recyclableCollectedKg: number | null;
  reusedKg: number | null;
  recycledKg: number | null;
  recoveryShare: number | null;
  matchedRecoveryKg: number;
  unconfirmedCollectedKg: number;
  missingIntake: number;
  conflicts: number;
  completedTransfers: number;
  intakeCoverage: number | null;
}

export interface RegionalPolicyRow extends PolicyMetrics {
  region: string;
  previousCollectedKg: number | null;
  collectionChangePercent: number | null;
  participatingSources: number;
  approvedHubs: number;
  hubWeighedBatches: number;
  facilities: number;
}

export interface ProducerPolicyRow extends PolicyMetrics {
  key: string;
  name: string;
  region: string;
  sources: number;
}

export interface GovernanceMonitoring {
  periodLabel: string;
  comparisonLabel: string | null;
  asOf: string;
  summary: PolicyMetrics;
  previous: PolicyMetrics;
  participatingOrganizations: number;
  regions: RegionalPolicyRow[];
  producers: ProducerPolicyRow[];
  producerNamesRestricted: boolean;
  quality: { totalIssues: number; critical: number; warnings: number; thresholdPercent: number };
  evidence: { reportedReceiptTransfers: number; missingTransferWeights: number; unlinkedOutcomeKg: number; missingGeography: number };
  hubDisposals: { available: boolean; records: number; disposedKg: number | null; invalidRecords: number };
  notes: string[];
}
