export interface PlatformActivityMetrics {
  registeredAccounts: number;
  listings: number;
  requests: number;
  completedTransfers: number;
  reportExports: number | null;
  exportScope: 'Platform' | 'Own';
  accountAsOf: string;
  monthlyActiveUsers: null;
  monthlyActiveUsersAvailable: false;
  sessions: null;
  averageSessionMinutes: null;
}
