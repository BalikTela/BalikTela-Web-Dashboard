import { encodeFlowEvent, encodeRecord } from './codecs.js';
import { WEB_PERSISTENCE_COLLECTION_MAP } from './schema.js';
import type { DatabaseShape } from '../types.js';

export type RecordMutation = { [K in keyof DatabaseShape]: { name: K; record: DatabaseShape[K][number]; previous?: DatabaseShape[K][number] } }[keyof DatabaseShape];
export interface CanonicalMutation { table: string; mode: 'insert' | 'update' | 'upsert'; id: string; values: Record<string, unknown>; expected: Record<string, unknown> }
const persistedRows=new WeakMap<object,Record<string,unknown>>();
export function rememberCanonicalRow<T extends object>(record:T,row:Record<string,unknown>):T {persistedRows.set(record,row);return record;}

export function canonicalMutations(mutations: RecordMutation[]): CanonicalMutation[] {
  const result: CanonicalMutation[] = [];
  for (const mutation of mutations) {
    const encoded = JSON.parse(JSON.stringify(encodeRecord(mutation.name, mutation.record))) as Record<string, unknown>;
    const { _id, ...values } = encoded;
    const expected: Record<string, unknown> = {};
    if (mutation.previous) {
      const before = JSON.parse(JSON.stringify(encodeRecord(mutation.name, mutation.previous))) as Record<string, unknown>;
      const persisted=persistedRows.get(mutation.previous);
      const previousValue = (key: string) => persisted && Object.hasOwn(persisted, key) ? persisted[key] : before[key];
      for (const key of Object.keys(values)) {
        if (key === 'created_at' || key === 'effective_from' || JSON.stringify(values[key]) === JSON.stringify(before[key])) delete values[key];
        else if (!key.endsWith('_at')) expected[key] = previousValue(key);
      }
      if ('status' in before) expected.status = previousValue('status');
      if ('current_status' in before) expected.current_status = previousValue('current_status');
      if(mutation.name==='materialBatches' && mutation.record.currentStatus!==mutation.previous.currentStatus) values.current_status=encoded.current_status;
      if (values.location && typeof values.location==='object' && !Array.isArray(values.location)) {
        const location=values.location as Record<string,unknown>;
        if ('city' in location) values.location={city:location.city,region:location.region};
      }
      delete expected.location;
    }
    result.push({ table: WEB_PERSISTENCE_COLLECTION_MAP[mutation.name], mode: mutation.previous ? 'update' : 'insert', id: String(_id), values, expected });
    if (mutation.name === 'users') {
      const user = mutation.record;
      result.push({ table: 'auth_account_security', mode: 'upsert', id: `AAS-${user.id}`, values: { user_id: user.id, email_verified_at: user.emailVerifiedAt, password_changed_at: user.passwordChangedAt, updated_at: new Date().toISOString() }, expected: {} });
    }
    if (mutation.name === 'transfers') {
      const transfer = mutation.record;
      const previousIds = new Set(mutation.previous?.events.map(event => event.id));
      transfer.events.forEach((event, index) => {
        if (previousIds.has(event.id)) return;
        const { _id: eventId, ...eventValues } = JSON.parse(JSON.stringify(encodeFlowEvent(transfer.id, transfer.batchId, transfer.listingId, event, index + 1)));
        result.push({ table: 'flow_events', mode: 'insert', id: eventId, values: eventValues, expected: {} });
      });
    }
  }
  return result;
}

export class MutationConflict extends Error {
  status = 409;
  constructor() { super('This record changed while you were editing. Reload it and try again.'); }
}

export class ManagementMigrationRequired extends Error {
  status=503;
  constructor() {super('Apply the management transaction migration in Supabase before saving this operation.');}
}

export function mergeJson(original: unknown, patch: unknown): unknown {
  if(original && patch && typeof original==='object' && typeof patch==='object' && !Array.isArray(original) && !Array.isArray(patch)) {
    const result={...original as Record<string,unknown>};
    for(const [key,value] of Object.entries(patch)) result[key]=mergeJson(result[key],value);
    return result;
  }
  return patch;
}
