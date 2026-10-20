import { isDeepStrictEqual } from 'node:util';
import type { CanonicalMutation } from '../../server/database/mutations.js';

export class ImportRemovalSafetyError extends Error {}
export type ImportRow = Record<string, unknown> & { id: string };
export const IMPORT_DELETE_ORDER = ['flow_events', 'recovery_records', 'measurements', 'transfers', 'match_requests', 'listings', 'material_batches'] as const;

export function removalAuditActor(logs: Array<{ actor_id: string; details: { summary?: string } }>, batchIds: ReadonlySet<string>, users: Array<{ id: string; role: string; accountStatus: string }>) {
  const actors = new Set<string>();
  for (const log of logs) {
    let detail: { batchIds?: unknown };
    try { detail = JSON.parse(log.details.summary ?? '{}'); } catch { continue; }
    if (Array.isArray(detail.batchIds) && detail.batchIds.length && detail.batchIds.every(id => typeof id === 'string' && batchIds.has(id))) actors.add(log.actor_id);
  }
  const [id] = actors;
  if (actors.size !== 1 || !users.some(user => user.id === id && user.role === 'Administrator' && user.accountStatus === 'Active'))
    throw new ImportRemovalSafetyError('An unambiguous active original importing administrator is required for the maintenance audit.');
  return id;
}

function normalized(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value) && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalized(item)]));
  return value;
}
const emptyDefault = (value: unknown) => value === null || value === false || value === 0 || value === ''
  || Array.isArray(value) && value.length === 0 || value && typeof value === 'object' && Object.keys(value).length === 0;

export function planImportRemoval(expected: CanonicalMutation[], current: Record<string, ImportRow[]>) {
  const expectedByTable = new Map<string, Map<string, CanonicalMutation>>();
  for (const item of expected) {
    if (!(IMPORT_DELETE_ORDER as readonly string[]).includes(item.table) || item.mode !== 'insert' || !/^IMP-DEMO-[a-f0-9]{24}-[A-Z0-9-]+$/.test(item.id))
      throw new ImportRemovalSafetyError('Unexpected removal target; only deterministic bulk-test lifecycle IDs are allowed.');
    const rows = expectedByTable.get(item.table) ?? new Map();
    if (rows.has(item.id)) throw new ImportRemovalSafetyError('Duplicate expected removal ID.');
    rows.set(item.id, item); expectedByTable.set(item.table, rows);
  }
  const result: Record<string, ImportRow[]> = {};
  for (const [table, rows] of Object.entries(current)) {
    result[table] = [];
    for (const row of rows) {
      const target = expectedByTable.get(table)?.get(row.id);
      if (!target) throw new ImportRemovalSafetyError(`Unexpected record in ${table}; no changes allowed.`);
      for (const [field, value] of Object.entries(target.values)) {
        // Database update triggers may stamp insertion time rather than the CSV lifecycle time.
        if (field === 'updated_at' && typeof row[field] === 'string' && typeof target.values.created_at === 'string'
          && Date.parse(row[field]) >= Date.parse(target.values.created_at) && Date.parse(row[field]) <= Date.now()) continue;
        if (!isDeepStrictEqual(normalized(row[field]), normalized(value)))
          throw new ImportRemovalSafetyError(`Imported record ${row.id} changed in ${table}.${field}; removal refused.`);
      }
      for (const [field, value] of Object.entries(row)) {
        // This shared schema has a literal placeholder default, not a real Auth identity.
        if (table === 'listings' && field === 'auth_user_id' && value === 'SUPABASE_AUTH_ID') continue;
        if (table === 'listings' && field === 'delivery_route' && value === 'via_hub' && row.weighing_hub_id == null) continue;
        if (field !== 'id' && !Object.hasOwn(target.values, field) && !emptyDefault(value))
          throw new ImportRemovalSafetyError(`Additional evidence exists in ${table}.${field} for ${row.id}; removal refused.`);
      }
      result[table].push(row);
    }
  }
  // A partially saved import is supported, but linked children require their original demo roots.
  const roots = new Set((result.material_batches ?? []).map(row => row.id.replace(/-BAT$/, '')));
  const listings = new Set((result.listings ?? []).map(row => row.id.replace(/-LST$/, '')));
  for (const rows of Object.values(result)) for (const row of rows) {
    const prefix = row.id.match(/^IMP-DEMO-[a-f0-9]{24}/)![0];
    if (!roots.has(prefix) || !listings.has(prefix)) throw new ImportRemovalSafetyError('Imported lifecycle roots are incomplete; removal refused.');
  }
  return result;
}
