import type { Filters } from '../types';
import { platformApi } from './platformApi';

export function getDashboardData(filters: Filters, signal?: AbortSignal) {
  return platformApi.dashboardAnalytics({
    dateRange: filters.dateRange,
    startDate: filters.startDate,
    endDate: filters.endDate,
    region: filters.region,
    city: filters.city,
    textileType: filters.textileType,
    transactionType: filters.transactionType,
    stakeholderType: filters.stakeholderType,
    producer: filters.producer,
    recycler: filters.recycler,
    wasteSource: filters.wasteSource,
    circularPathway: filters.circularPathway,
    weightStatus: filters.weightStatus,
    facilityId: filters.facilityId,
    organizationId: filters.organizationId,
    transactionStatus: filters.transactionStatus,
  }, signal);
}
