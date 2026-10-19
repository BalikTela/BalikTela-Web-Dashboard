import { isDeepStrictEqual } from 'node:util';

export type DemoRow = Record<string, unknown> & { id: string };
export interface DemoTable { table: string; rows: DemoRow[] }
export interface DemoMutation { table: string; id: string; before: DemoRow | null; after: DemoRow; patch: Record<string, unknown> }

export const DEMO_LIFECYCLE_COLUMNS: Record<string, string[]> = {
  material_batches: ['declared_weight_kg', 'current_weight_kg', 'intended_pathway', 'condition', 'current_status', 'final_pathway'],
  measurements: ['batch_id', 'weight_kg', 'note', 'measurement_context', 'measured_at', 'created_at'],
  listings: ['batch_id', 'description'],
  transfers: ['batch_id'],
  recovery_records: ['batch_id', 'transfer_id', 'input_kg', 'output_kg', 'rejected_kg', 'outcome', 'note'],
  flow_events: ['batch_id', 'sequence', 'occurred_at', 'created_at'],
};

function sameValue(key: string, actual: unknown, value: unknown) {
  return key === 'updated_at'
    || key.endsWith('_at') && typeof value === 'string' && typeof actual === 'string'
      && Number.isFinite(Date.parse(value)) && Date.parse(actual) === Date.parse(value)
    || isDeepStrictEqual(actual, value);
}

function preservedField(table: string, key: string) { return table === 'listings' && key === 'status'; }
function sameProjection(actual: DemoRow, expected: DemoRow, table = '') {
  return Object.entries(expected).every(([key, value]) => preservedField(table, key) || sameValue(key, actual[key], value));
}

export function verifyDemoDependencies(actual: DemoRow[], expected: DemoRow[]) {
  const known = new Map(expected.map(row => [row.id, row]));
  if (actual.length !== expected.length || actual.some(row => !known.has(row.id) || !sameProjection(row, known.get(row.id)!))) {
    throw new Error('Referenced demo offers or rewards were edited; the lifecycle repair cannot continue.');
  }
}

export function planDemoLifecycle(legacy: DemoTable[], completed: DemoTable[], current: DemoTable[]) {
  const mutations: DemoMutation[] = [];
  for (const table of completed) {
    const allowed = DEMO_LIFECYCLE_COLUMNS[table.table];
    if (!allowed) throw new Error('Lifecycle repair cannot write this table.');
    const oldRows = new Map(legacy.find(item => item.table === table.table)?.rows.map(row => [row.id, row]));
    const currentRows = new Map(current.find(item => item.table === table.table)?.rows.map(row => [row.id, row]));
    for (const after of table.rows) {
      if (!/^SYN-(BAT|MSR|LST|TRF|RCV|EVT)-/.test(after.id)
        || 'is_demo' in after && after.is_demo !== true) throw new Error('Lifecycle repair only accepts explicitly generated demo records.');
      const before = currentRows.get(after.id);
      const old = oldRows.get(after.id);
      if (before && 'is_demo' in before && before.is_demo !== true) throw new Error(`Refusing non-demo ID collision in ${table.table}.`);
      if (before && sameProjection(before, after, table.table)) continue;
      if (!before) {
        if (old) throw new Error(`An original synthetic record is missing from ${table.table}.`);
        mutations.push({ table: table.table, id: after.id, before: null, after, patch: after });
        continue;
      }
      // Exact historical seed variants only: validation measurements ran late, and REC events ran early.
      let originalTiming: DemoRow | null = null;
      if (old && !old.id.includes('OCT26-')) {
        if (table.table === 'measurements' && old.stage === 'validation') originalTiming = { ...old,
          measured_at: new Date(Date.parse(String(old.measured_at)) + 3_600_000).toISOString(), created_at: new Date(Date.parse(String(old.created_at)) + 3_600_000).toISOString() };
        if (table.table === 'flow_events' && /-REC-[45]$/.test(old.id)) originalTiming = { ...old,
          occurred_at: new Date(Date.parse(String(old.occurred_at)) - 3_600_000).toISOString(), created_at: new Date(Date.parse(String(old.created_at)) - 3_600_000).toISOString() };
      }
      if (!old || !sameProjection(before, old, table.table) && !(originalTiming && sameProjection(before, originalTiming, table.table))) {
        const fields = old ? Object.keys(old).filter(key => !sameValue(key, before[key], old[key])).join(', ') : 'existing ID';
        throw new Error(`Synthetic record was edited or conflicts with the expected lifecycle: ${table.table}/${after.id} (${fields}).`);
      }
      const differences = Object.keys(after).filter(key => key !== 'id' && !preservedField(table.table, key) && !sameValue(key, before[key], after[key]));
      if (differences.some(key => !allowed.includes(key))) throw new Error(`Unexpected synthetic field change in ${table.table}/${after.id}: ${differences.filter(key => !allowed.includes(key)).join(', ')}.`);
      if (differences.length) mutations.push({ table: table.table, id: after.id, before, after, patch: Object.fromEntries(differences.map(key => [key, after[key]])) });
    }
  }
  return mutations;
}
