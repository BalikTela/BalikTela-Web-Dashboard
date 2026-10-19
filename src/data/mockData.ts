import type {
  Facility,
  LifecycleEvent,
  Stakeholder,
  StakeholderType,
  TextileType,
  Transaction,
  TransactionStatus,
  TransactionType,
  WasteRecord,
} from '../types.js';

export const reportingYear = 2026;
export const reportingCutoff = '2026-09-21';
export const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];

export const regionProfiles = [
  {
    region: 'Metro Manila' as const,
    share: 0.48,
    cities: ['Makati', 'Quezon City', 'Manila'],
    producers: ['Bench / Suyen (demo partner record)', 'Metro Apparel Group (sample)'],
    recyclers: ['Green Loop Cooperative (sample)', 'Manila Preprocess Center (sample)'],
    collectionPoints: 46,
    producerCount: 24,
    recyclerCount: 8,
    x: 51,
    y: 31,
  },
  {
    region: 'Central Visayas' as const,
    share: 0.2,
    cities: ['Cebu City'],
    producers: ['Cebu Apparel Makers Guild (sample)'],
    recyclers: ['Cebu FiberWorks (sample)'],
    collectionPoints: 13,
    producerCount: 7,
    recyclerCount: 3,
    x: 56,
    y: 58,
  },
  {
    region: 'Western Visayas' as const,
    share: 0.14,
    cities: ['Iloilo City'],
    producers: ['Iloilo Retail Returns (sample)'],
    recyclers: ['Panay Circular Textile Lab (sample)'],
    collectionPoints: 9,
    producerCount: 5,
    recyclerCount: 3,
    x: 45,
    y: 60,
  },
  {
    region: 'Davao Region' as const,
    share: 0.18,
    cities: ['Davao City'],
    producers: ['Davao Beneficiary Network (sample)'],
    recyclers: ['Mindanao Weave Renewal (sample)'],
    collectionPoints: 8,
    producerCount: 6,
    recyclerCount: 4,
    x: 67,
    y: 78,
  },
];

const textileProfiles: Array<{
  type: TextileType;
  share: number;
  reuseRate: number;
  recycleRate: number;
  transactionType: TransactionType;
  stakeholderType: Exclude<StakeholderType, 'Administrator'>;
}> = [
  { type: 'Cotton', share: 0.3, reuseRate: 0.22, recycleRate: 0.53, transactionType: 'Return', stakeholderType: 'Consumer' },
  { type: 'Polyester', share: 0.18, reuseRate: 0.08, recycleRate: 0.62, transactionType: 'Recycling', stakeholderType: 'Producer' },
  { type: 'Denim', share: 0.13, reuseRate: 0.16, recycleRate: 0.55, transactionType: 'Collection', stakeholderType: 'Producer' },
  { type: 'Mixed fabric', share: 0.21, reuseRate: 0.12, recycleRate: 0.38, transactionType: 'Barter', stakeholderType: 'Consumer' },
  { type: 'Uniforms', share: 0.1, reuseRate: 0.38, recycleRate: 0.35, transactionType: 'Donation', stakeholderType: 'NGO' },
  { type: 'Household linen', share: 0.08, reuseRate: 0.34, recycleRate: 0.4, transactionType: 'Redistribution', stakeholderType: 'Consumer' },
];

const nationalGeneratedKg = [19200, 21400, 25700, 28600, 31100, 36400, 41200, 44800, 49300];

export const wasteRecords: WasteRecord[] = (() => {
  const records: WasteRecord[] = [];
  nationalGeneratedKg.forEach((nationalTotal, monthOffset) => {
    const monthIndex = monthOffset + 1;
    regionProfiles.forEach((region, regionIndex) => {
      textileProfiles.forEach((textile, textileIndex) => {
        const generatedKg = Math.round(nationalTotal * region.share * textile.share);
        const collectionRate = 0.57 + (3 - regionIndex) * 0.035 + monthIndex * 0.009;
        const collectedKg = Math.round(generatedKg * collectionRate);
        const sortedKg = Math.round(collectedKg * (0.9 + monthIndex * 0.004));
        const reusedKg = Math.round(sortedKg * textile.reuseRate);
        const recycledKg = Math.round(sortedKg * textile.recycleRate);
        const city = region.cities[(monthOffset + textileIndex) % region.cities.length];

        records.push({
          id: `WF-${reportingYear}-${String(monthIndex).padStart(2, '0')}-${regionIndex + 1}-${textileIndex + 1}`,
          month: monthNames[monthOffset],
          monthIndex,
          date: `${reportingYear}-${String(monthIndex).padStart(2, '0')}-${String(8 + textileIndex * 2).padStart(2, '0')}`,
          region: region.region,
          city,
          textileType: textile.type,
          transactionType: textile.transactionType,
          stakeholderType: textile.stakeholderType,
          producer: region.producers[(monthOffset + textileIndex) % region.producers.length],
          recycler: region.recyclers[(monthOffset + textileIndex) % region.recyclers.length],
          generatedKg,
          collectedKg,
          sortedKg,
          reusedKg,
          recycledKg,
          transactionCount: Math.max(1, Math.round(collectedKg / 15)),
        });
      });
    });
  });
  return records;
})();

export const engagementRecords = monthNames.flatMap((month, monthOffset) =>
  regionProfiles.flatMap((region, regionIndex) => {
    const nationalActiveUsers = [5140, 5520, 6080, 6520, 7040, 7610, 8140, 8560, 8924][monthOffset];
    const regionActiveUsers = Math.round(nationalActiveUsers * region.share);
    const baseCityUsers = Math.floor(regionActiveUsers / region.cities.length);
    return region.cities.map((city, cityIndex) => {
      const activeUsers = cityIndex === region.cities.length - 1 ? regionActiveUsers - baseCityUsers * (region.cities.length - 1) : baseCityUsers;
      return {
        month,
        monthIndex: monthOffset + 1,
        region: region.region,
        city,
        activeUsers,
        sessions: Math.round(activeUsers * (2.1 + monthOffset * 0.08)),
        wasteSubmissions: Math.round(activeUsers * 0.31),
        barterActions: Math.round(activeUsers * 0.18),
        reportExports: Math.round(activeUsers * 0.018),
        averageSessionMinutes: Number((5.2 + monthOffset * 0.18 - regionIndex * 0.08).toFixed(1)),
      };
    });
  }),
);

export const barterActivityRecords = wasteRecords
  .filter((record) => record.transactionType === 'Barter')
  .map((record) => {
    const listings = Math.max(1, Math.round(record.transactionCount * 0.74));
    const matches = Math.round(listings * 0.68);
    const validated = Math.round(matches * 0.82);
    const completed = Math.round(validated * 0.88);
    return { monthIndex: record.monthIndex, region: record.region, city: record.city, textileType: record.textileType, producer: record.producer, recycler: record.recycler, listings, matches, validated, completed, rewardCredits: completed * 22 };
  });

const lifecycleStatusIndex: Partial<Record<TransactionStatus, number>> = {
  Completed: 99,
  'In sorting': 3,
  'In transit': 2,
  'Pending validation': 2,
  Flagged: 3,
};

function lifecycle(date: string, status: TransactionStatus, location: string, stages: Array<[string, string, string]>): LifecycleEvent[] {
  const currentIndex = lifecycleStatusIndex[status] ?? -1;
  return stages.map(([stage, actor, note], index) => {
    const isException = status === 'Flagged' && index === currentIndex;
    const eventStatus = isException ? 'Exception' : index < currentIndex || status === 'Completed' ? 'Completed' : index === currentIndex ? 'Current' : 'Pending';
    return {
      id: `${date}-${index + 1}`,
      stage,
      actor,
      timestamp: eventStatus === 'Pending' ? null : `${date}T${String(8 + index * 2).padStart(2, '0')}:15:00+08:00`,
      status: eventStatus,
      location,
      note,
    };
  });
}

const standardStages: Array<[string, string, string]> = [
  ['Source recorded', 'Producer / retailer', 'Material source and declared textile type recorded.'],
  ['Return accepted', 'BalikTela collection point', 'Weight and intake record captured.'],
  ['Transport', 'Logistics partner', 'Material moved under a sample chain-of-custody record.'],
  ['Sorting and validation', 'Sorting facility', 'Material composition and contamination checked.'],
  ['Recycler intake', 'Recycler', 'Receiving weight and processing route recorded.'],
  ['Final outcome', 'Recycler / reuse partner', 'Reuse or recycling outcome entered in the audit record.'],
];

const barterStages: Array<[string, string, string]> = [
  ['Listing created', 'Consumer', 'Textile item, condition, and exchange preference recorded.'],
  ['Potential match recorded', 'BalikTela matching workflow', 'Demo match based on item and location preferences.'],
  ['Validation', 'Community validator', 'Item details and exchange eligibility reviewed.'],
  ['Exchange accepted', 'Barter participants', 'Both parties confirmed the exchange.'],
  ['Handover recorded', 'Collection point / participants', 'Item handover entered in the audit record.'],
  ['Reward activity', 'BalikTela rewards workflow', 'Demo credits released after completion.'],
];

export const transactions: Transaction[] = [
  makeTransaction('BT-2609-1184', '2026-09-19', 'Bench Glorietta collection desk (demo)', 'Green Loop Cooperative (sample)', 'Return', 'Cotton', 286, 'Makati, Metro Manila', 'Metro Manila', 'Completed', 214, 'S-001', 'S-003'),
  makeTransaction('BT-2609-1176', '2026-09-18', 'Quezon City community hub (sample)', 'Barangay Textile Share Program (sample)', 'Donation', 'Uniforms', 92, 'Quezon City, Metro Manila', 'Metro Manila', 'Completed', 67, undefined, 'S-005'),
  makeTransaction('BT-2608-1162', '2026-08-26', 'Cebu Apparel Makers Guild (sample)', 'Cebu FiberWorks (sample)', 'Recycling', 'Mixed fabric', 640, 'Cebu City, Central Visayas', 'Central Visayas', 'In sorting', undefined, 'S-002', 'S-004'),
  makeTransaction('BT-2608-1151', '2026-08-15', 'Iloilo Retail Returns (sample)', 'Panay Circular Textile Lab (sample)', 'Collection', 'Denim', 310, 'Iloilo City, Western Visayas', 'Western Visayas', 'In transit', undefined, undefined, 'S-007'),
  makeTransaction('BT-2607-1147', '2026-07-24', 'Davao Beneficiary Network (sample)', 'Mindanao Weave Renewal (sample)', 'Barter', 'Household linen', 74, 'Davao City, Davao Region', 'Davao Region', 'Pending validation', undefined, 'S-006', undefined),
  makeTransaction('BT-2606-1129', '2026-06-11', 'Manila Hotel Linen Pool (sample)', 'Tondo Upcycle Studio (sample)', 'Redistribution', 'Household linen', 155, 'Manila, Metro Manila', 'Metro Manila', 'Completed', 110, undefined, 'S-005'),
  makeTransaction('BT-2605-1114', '2026-05-09', 'Makati Premium Retail Group (sample)', 'Green Loop Cooperative (sample)', 'Recycling', 'Polyester', 504, 'Makati, Metro Manila', 'Metro Manila', 'Flagged', undefined, undefined, 'S-003'),
];

function makeTransaction(
  id: string,
  date: string,
  source: string,
  destination: string,
  type: TransactionType,
  textileCategory: TextileType,
  weightKg: number,
  location: string,
  region: Transaction['region'],
  status: TransactionStatus,
  estimatedImpactKg?: number,
  sourceStakeholderId?: string,
  destinationStakeholderId?: string,
): Transaction {
  return {
    id, date, source, destination, type, textileCategory, weightKg, location, region, status,
    impact: estimatedImpactKg ? `Est. ${estimatedImpactKg.toLocaleString()} kg diverted` : status === 'Completed' ? 'Completed; estimate pending review' : 'Outcome pending',
    estimatedImpactKg,
    sourceStakeholderId,
    destinationStakeholderId,
    lifecycle: lifecycle(date, status, location, type === 'Barter' ? barterStages : standardStages),
    isDemo: true,
  };
}

export const stakeholders: Stakeholder[] = [
  stakeholder('S-001', 'Bench / Suyen (demo partner record)', 'Producer', 'Makati', 'Metro Manila', 8200, 12400, 88, 814, 'Demo verified', 84, ['Store-return pilot', 'Post-consumer collection']),
  stakeholder('S-002', 'Cebu Apparel Makers Guild (sample)', 'Producer', 'Cebu City', 'Central Visayas', 4500, 9700, 62, 321, 'Pending demo review', 66, ['Production offcut reporting', 'Regional collection']),
  stakeholder('S-003', 'Green Loop Cooperative (sample)', 'Recycler', 'Quezon City', 'Metro Manila', 10800, 0, 91, 540, 'Demo verified', 88, ['Fiber recovery', 'Recycler intake validation'], 15000, 72),
  stakeholder('S-004', 'Cebu FiberWorks (sample)', 'Recycler', 'Cebu City', 'Central Visayas', 6300, 0, 76, 214, 'Demo verified', 79, ['Mechanical recycling', 'Mixed-fabric sorting'], 9000, 84),
  stakeholder('S-005', 'Tondo Upcycle Studio (sample)', 'NGO', 'Manila', 'Metro Manila', 2100, 0, 81, 196, 'Demo verified', 82, ['Linen redistribution', 'Community upcycling']),
  stakeholder('S-006', 'Davao Beneficiary Network (sample)', 'Consumer', 'Davao City', 'Davao Region', 1700, 2200, 58, 408, 'Pending demo review', 61, ['Barter participation', 'Household linen returns']),
  stakeholder('S-007', 'Panay Circular Textile Lab (sample)', 'Recycler', 'Iloilo City', 'Western Visayas', 3800, 0, 69, 178, 'Demo verified', 75, ['Denim recovery', 'Regional recycler intake'], 7200, 53),
];

function stakeholder(
  id: string, name: string, type: Stakeholder['type'], city: string, region: Stakeholder['region'], recoveredKg: number, generatedKg: number,
  participation: number, transactionCount: number, verification: Stakeholder['verification'], reliabilityPlaceholder: number, sustainabilityActivities: string[], capacityKg?: number, utilization?: number,
): Stakeholder {
  return { id, name, type, city, region, recoveredKg, generatedKg, capacityKg, utilization, participation, transactions: transactionCount, verification, reliabilityPlaceholder, sustainabilityActivities, joinedAt: '2026-01-15', isDemo: true };
}

export const facilities: Facility[] = [
  { id: 'F-01', name: 'Green Loop Cooperative (sample)', location: 'Quezon City', region: 'Metro Manila', acceptedTypes: allTextileTypes(), capacityKg: 15000, utilization: 0, intakeKg: 0, processedKg: 0, processingTimeDays: 5.2, status: 'Available', isDemo: true },
  { id: 'F-02', name: 'Cebu FiberWorks (sample)', location: 'Cebu City', region: 'Central Visayas', acceptedTypes: allTextileTypes(), capacityKg: 9000, utilization: 0, intakeKg: 0, processedKg: 0, processingTimeDays: 6.8, status: 'Near capacity', isDemo: true },
  { id: 'F-03', name: 'Panay Circular Textile Lab (sample)', location: 'Iloilo City', region: 'Western Visayas', acceptedTypes: allTextileTypes(), capacityKg: 7200, utilization: 0, intakeKg: 0, processedKg: 0, processingTimeDays: 4.7, status: 'Available', isDemo: true },
  { id: 'F-04', name: 'Mindanao Weave Renewal (sample)', location: 'Davao City', region: 'Davao Region', acceptedTypes: allTextileTypes(), capacityKg: 5200, utilization: 0, intakeKg: 0, processedKg: 0, processingTimeDays: 7.1, status: 'Pilot onboarding', isDemo: true },
  { id: 'F-05', name: 'Manila Preprocess Center (sample)', location: 'Manila', region: 'Metro Manila', acceptedTypes: allTextileTypes(), capacityKg: 11000, utilization: 0, intakeKg: 0, processedKg: 0, processingTimeDays: 3.9, status: 'Near capacity', isDemo: true },
];

function allTextileTypes(): TextileType[] { return textileProfiles.map((profile) => profile.type); }
