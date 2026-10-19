import { engagementRecords, wasteRecords } from '../../src/data/mockData.js';
import { buildOperationalDemo } from './operationalDemo.js';

export const OCTOBER_DATASET = 'synthetic-operational-october-2026-v2';
export const OCTOBER_CUTOFF = '2026-10-16T23:59:59.999+08:00';

export function buildOctoberDemo(options: { lifecycleVersion?: 1 | 2 } = {}) {
  // An explicit illustrative MTD scenario, not an extrapolation of observed October activity.
  const records = wasteRecords.filter(record => record.monthIndex === 9).map((record, index) => {
    const generatedKg = Math.round(record.generatedKg * 1.08);
    const collectedKg = Math.min(generatedKg, Math.round(record.collectedKg * 1.08));
    const sortedKg = Math.min(collectedKg, Math.round(record.sortedKg * 1.08));
    const reusedKg = Math.round(record.reusedKg * 1.08);
    const recycledKg = Math.min(sortedKg - reusedKg, Math.round(record.recycledKg * 1.08));
    return { ...record, id: record.id.replace('WF-2026-09-', 'WF-OCT26-2026-10-'),
      month: 'Oct', monthIndex: 10, date: `2026-10-${String(1 + Math.floor(index * 16 / 24)).padStart(2, '0')}`,
      generatedKg, collectedKg, sortedKg, reusedKg, recycledKg,
    };
  });
  const engagement = engagementRecords.filter(record => record.monthIndex === 9).map(record => ({ ...record,
    month: 'Oct', monthIndex: 10, activeUsers: Math.round(record.activeUsers * 1.03),
    sessions: Math.round(record.sessions * 1.03), wasteSubmissions: Math.round(record.wasteSubmissions * 1.08),
    barterActions: Math.round(record.barterActions * 1.08), reportExports: Math.round(record.reportExports * 1.03),
  }));
  const demo = buildOperationalDemo(records, engagement, null, options);
  // Existing, fictional SYN registry records are reused. Never provision or reactivate accounts here.
  const domainTables = demo.domainTables.filter(([name]) => !['users', 'organizations', 'facilities'].includes(name));
  for (const [name, rows] of domainTables) {
    if (name === 'systemInteractions') for (const row of rows) {
      if ('occurredAt' in row) {
        row.id = row.id.replace('SYN-INT-', 'SYN-INT-OCT26-');
        row.occurredAt = '2026-10-16T12:00:00.000Z';
      }
    }
  }
  return { records, domainTables, flowEvents: demo.flowEvents, dataset: OCTOBER_DATASET,
    cutoff: OCTOBER_CUTOFF, summary: {
      batches: (domainTables.find(([name]) => name === 'materialBatches')?.[1] ?? []).length,
      sourceCohorts: records.length,
      declaredKg: records.reduce((sum, record) => sum + record.generatedKg, 0),
      collectedKg: records.reduce((sum, record) => sum + record.collectedKg, 0),
      sortedKg: records.reduce((sum, record) => sum + record.sortedKg, 0),
      reusedKg: records.reduce((sum, record) => sum + record.reusedKg, 0),
      recycledKg: records.reduce((sum, record) => sum + record.recycledKg, 0),
    } };
}
