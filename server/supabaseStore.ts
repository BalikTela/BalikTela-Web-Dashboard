import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { decodeRecord, encodeFlowEvent, encodeRecord } from './database/codecs.js';
import { WEB_PERSISTENCE_COLLECTION_MAP } from './database/schema.js';
import { DatabaseOperationError } from './database/errors.js';
import { canonicalMutations, mergeJson, rememberCanonicalRow, ManagementMigrationRequired, MutationConflict, type RecordMutation } from './database/mutations.js';
import type { DashboardSourceSnapshot, Store } from './store.js';
import type { AuthChallengeRecord, AuthRateLimitRecord, AuthSessionRecord, DatabaseShape } from './types.js';
import { IMPORT_RECORD_NAMES, type ImportExistingRecord, type ImportRecordLookup } from '../shared/imports.js';

type CollectionName = keyof DatabaseShape;
type RecordFor<K extends CollectionName> = DatabaseShape[K][number];
type Row = Record<string, unknown> & { id: string };

export class SupabaseStore implements Store {
  mode = 'supabase' as const;
  private client: SupabaseClient;
  private snapshotRpcRetryAt = 0;

  constructor(url: string, secretKey: string, fetcher?: typeof fetch) {
    this.client = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      ...(fetcher ? { global: { fetch: fetcher } } : {}),
    });
  }

  private table<K extends CollectionName>(name: K) { return WEB_PERSISTENCE_COLLECTION_MAP[name]; }

  async lookupImportRecords(lookups: ImportRecordLookup[]): Promise<ImportExistingRecord[]> {
    const records: ImportExistingRecord[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (next < lookups.length) {
        const { name, ids } = lookups[next++];
        if (!IMPORT_RECORD_NAMES.includes(name)) throw new Error('Unsupported import collection.');
        const uniqueIds = [...new Set(ids)];
        const columns = name === 'listings' ? 'id,is_demo,description' : name === 'materialBatches' ? 'id,is_demo' : 'id';
        for (let offset = 0; offset < uniqueIds.length; offset += 100) {
          const selected = uniqueIds.slice(offset, offset + 100);
          let cursor: string | undefined;
          for (;;) {
            let query = this.client.from(this.table(name)).select(columns).in('id', selected).order('id').limit(100);
            if (cursor !== undefined) query = query.gt('id', cursor);
            const { data, error } = await query;
            if (error) throw databaseError(`read import ${this.table(name)}`, error);
            const rows = (data ?? []) as unknown as Row[];
            if (!rows.length) break;
            records.push(...rows.map(row => ({ name, id: row.id, isDemo: row.is_demo === true,
              ...(name === 'listings' ? { description: String(row.description ?? '') } : {}) })));
            const last = rows[rows.length - 1].id;
            if (last === cursor) throw new Error('Import lookup pagination did not advance.');
            cursor = last;
            if (rows.length === selected.length) break;
          }
        }
      }
    }));
    return records;
  }

  async loadHubDisposals() {
    const records: import('../shared/hubs.js').HubDisposalRecord[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await this.client.from('hub_disposals')
        .select('id,listing_id,operator_id,listing_title,category,weight_kg,reason,disposed_at')
        .order('id').range(offset, offset + 999);
      if (error && ['42P01', 'PGRST205'].includes(error.code)) return { available: false, records: [] };
      if (error) throw databaseError('read hub_disposals', error);
      records.push(...(data ?? []).map(row => ({ id: row.id, listingId: row.listing_id, operatorId: row.operator_id,
        listingTitle: row.listing_title, category: row.category, weightKg: row.weight_kg === null ? NaN : Number(row.weight_kg),
        reason: row.reason ?? '', disposedAt: row.disposed_at })));
      if ((data?.length ?? 0) < 1000) break;
    }
    return { available: true, records };
  }

  async all<K extends CollectionName>(name: K) {
    const rows: Row[] = [];
    const pageSize = 1_000;
    for (let offset = 0; ; offset += pageSize) {
      let query = this.client.from(this.table(name)).select('*').order('id', { ascending: true }).range(offset, offset + pageSize - 1);
      if (name === 'configurations') query = query.eq('status', 'active');
      const { data, error } = await query;
      if (error) throw databaseError(`read ${this.table(name)}`, error);
      rows.push(...((data ?? []) as Row[]));
      if ((data?.length ?? 0) < pageSize) break;
    }
    const documents = rows.map(toDocument);
    await this.enrich(name, documents);
    return documents.map((document) => rememberCanonicalRow(decodeRecord(name, document),document)) as RecordFor<K>[];
  }

  async findById<K extends CollectionName>(name: K, id: string) {
    const canonicalId = name === 'configurations' ? `CFG-${id}-v1` : id;
    const rowRequest = this.client.from(this.table(name)).select('*').eq('id', canonicalId).maybeSingle();
    if (name === 'users') {
      const [rowResult, securityResult] = await Promise.all([
        rowRequest,
        this.client.from('auth_account_security').select('*').eq('user_id', id).maybeSingle(),
      ]);
      if (rowResult.error) throw databaseError(`read ${this.table(name)}`, rowResult.error);
      if (securityResult.error) throw databaseError('read auth_account_security', securityResult.error);
      if (!rowResult.data) return null;
      const document = toDocument(rowResult.data as Row) as Record<string, unknown>;
      if (securityResult.data) document._security = toDocument(securityResult.data as Row);
      return rememberCanonicalRow(decodeRecord(name, document),document) as RecordFor<K>;
    }

    const { data, error } = await rowRequest;
    if (error) throw databaseError(`read ${this.table(name)}`, error);
    if (!data) return null;
    const document = toDocument(data as Row);
    await this.enrich(name, [document]);
    return rememberCanonicalRow(decodeRecord(name, document),document) as RecordFor<K>;
  }

  async findOne<K extends CollectionName>(name: K, predicate: (record: RecordFor<K>) => boolean) {
    const records = await this.all(name);
    return records.find(predicate) ?? null;
  }

  async insert<K extends CollectionName>(name: K, record: RecordFor<K>) {
    const row = toRow(encodeRecord(name, record));
    const { error } = await this.client.from(this.table(name)).insert(row);
    if (error) throw databaseError(`insert ${this.table(name)}`, error);
    if (name === 'users') await this.syncUserSecurity(record as RecordFor<'users'>);
    if (name === 'transfers') await this.syncFlowEvents(record as RecordFor<'transfers'>);
    return record;
  }

  async update<K extends CollectionName>(name: K, id: string, patch: Partial<RecordFor<K>>) {
    const existingRecord = await this.findById(name, id);
    if (!existingRecord) return null;
    const merged = { ...existingRecord, ...patch } as RecordFor<K>;
    const mutation={name,record:merged,previous:existingRecord} as RecordMutation;
    try {await this.commit([mutation]);} catch(error) {
      if(!(error instanceof ManagementMigrationRequired)) throw error;
      // Single-record legacy updates stay available while the additive migration is pending.
      const operation=canonicalMutations([mutation])[0];
      const {data:raw,error:readError}=await this.client.from(operation.table).select('*').eq('id',operation.id).single();
      if(readError)throw databaseError('read update target',readError);
      const values=Object.fromEntries(Object.entries(operation.values).map(([key,value])=>[key,mergeJson(raw[key],value)]));
      const {error:updateError}=await this.client.from(operation.table).update(values).eq('id',operation.id);
      if(updateError)throw databaseError('update record',updateError);
      if(name==='users')await this.syncUserSecurity(merged as RecordFor<'users'>);
      if(name==='transfers')await this.syncFlowEvents(merged as RecordFor<'transfers'>);
    }
    return this.findById(name, id);
  }

  async commit(mutations: RecordMutation[]) {
    const { error } = await this.client.rpc('apply_management_mutations', { p_mutations: canonicalMutations(mutations) });
    if(error?.code==='PGRST202'||error?.code==='42883')throw new ManagementMigrationRequired();
    if (error?.code === 'PT409' || error?.code === '40001' || error?.code === '23505') throw new MutationConflict();
    if (error) throw databaseError('save management transaction', error);
  }

  async createSession(session: AuthSessionRecord) {
    const { error } = await this.client.from('sessions').insert({
      id: session.id, user_id: session.userId, client: session.client, token_hash: session.tokenHash,
      used_token_hashes: session.usedTokenHashes, csrf_hash: session.csrfHash, expires_at: session.expiresAt,
      revoked_at: session.revokedAt, created_at: session.createdAt, updated_at: session.updatedAt,
    });
    if (error) throw databaseError('create session', error);
    return session;
  }

  async findSession(id: string) {
    const { data, error } = await this.client.from('sessions').select('*').eq('id', id).maybeSingle();
    if (error) throw databaseError('find session', error);
    return data ? decodeSession(data) : null;
  }

  async listUserSessions(userId: string) {
    const { data, error } = await this.client.from('sessions').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw databaseError('list sessions', error);
    return (data ?? []).map(decodeSession);
  }

  async rotateSessionToken(id: string, presentedHash: string, nextHash: string, nextCsrfHash: string, updatedAt: string) {
    const { data, error } = await this.client.rpc('rotate_auth_session', {
      p_id: id, p_presented_hash: presentedHash, p_next_hash: nextHash, p_next_csrf_hash: nextCsrfHash, p_updated_at: updatedAt,
    });
    if (error) throw databaseError('rotate session', error);
    return String(data) as 'rotated' | 'replayed' | 'invalid';
  }

  async revokeSession(id: string, userId: string, revokedAt: string) {
    const { data, error } = await this.client.from('sessions').update({ revoked_at: revokedAt, updated_at: revokedAt }).eq('id', id).eq('user_id', userId).is('revoked_at', null).select('id');
    if (error) throw databaseError('revoke session', error);
    return Boolean(data?.length);
  }

  async revokeUserSessions(userId: string, revokedAt: string) {
    const { data, error } = await this.client.from('sessions').update({ revoked_at: revokedAt, updated_at: revokedAt }).eq('user_id', userId).is('revoked_at', null).select('id');
    if (error) throw databaseError('revoke user sessions', error);
    return data?.length ?? 0;
  }

  async createAuthChallenge(challenge: AuthChallengeRecord) {
    const { error } = await this.client.from('auth_challenges').insert({
      id: challenge.id, user_id: challenge.userId, type: challenge.type, token_hash: challenge.tokenHash, client: challenge.client,
      expires_at: challenge.expiresAt, consumed_at: challenge.consumedAt, created_at: challenge.createdAt, updated_at: challenge.updatedAt,
    });
    if (error) throw databaseError('create authentication challenge', error);
    return challenge;
  }

  async consumeAuthChallenge(tokenHash: string, type: AuthChallengeRecord['type'], consumedAt: string) {
    const { data, error } = await this.client.rpc('consume_auth_challenge', { p_token_hash: tokenHash, p_type: type, p_consumed_at: consumedAt });
    if (error) throw databaseError('consume authentication challenge', error);
    const row = Array.isArray(data) ? data[0] : data;
    return row ? decodeChallenge(row) : null;
  }

  async invalidateAuthChallenges(userId: string, type: AuthChallengeRecord['type'], consumedAt: string) {
    const { data, error } = await this.client.from('auth_challenges').update({ consumed_at: consumedAt, updated_at: consumedAt }).eq('user_id', userId).eq('type', type).is('consumed_at', null).select('id');
    if (error) throw databaseError('invalidate authentication challenges', error);
    return data?.length ?? 0;
  }

  async findRateLimit(id: string) {
    const { data, error } = await this.client.from('auth_rate_limits').select('*').eq('id', id).maybeSingle();
    if (error) throw databaseError('find authentication rate limit', error);
    return data ? decodeRateLimit(data) : null;
  }

  async recordRateLimitFailure(id: string, scope: AuthRateLimitRecord['scope'], subjectHash: string, now: string, windowSeconds: number, maxAttempts: number, lockSeconds: number) {
    const { data, error } = await this.client.rpc('record_auth_rate_limit_failure', {
      p_id: id, p_scope: scope, p_subject_hash: subjectHash, p_now: now, p_window_seconds: windowSeconds,
      p_max_attempts: maxAttempts, p_lock_seconds: lockSeconds,
    });
    if (error) throw databaseError('record authentication rate limit', error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Authentication rate-limit state could not be recorded.');
    return decodeRateLimit(row);
  }

  async clearRateLimit(id: string) {
    const { error } = await this.client.from('auth_rate_limits').delete().eq('id', id);
    if (error) throw databaseError('clear authentication rate limit', error);
  }

  async loadDashboardSnapshot(): Promise<DashboardSourceSnapshot | null> {
    if (Date.now() < this.snapshotRpcRetryAt) return this.loadPagedDashboardSnapshot();
    const { data, error } = await this.client.rpc('get_dashboard_source_snapshot');
    if (error) {
      // Avoid repeatedly running a timed-out aggregate while independent table reads can succeed.
      if (['57014', 'PGRST202', '42883'].includes(error.code)) {
        this.snapshotRpcRetryAt = Date.now() + 5 * 60_000;
        return this.loadPagedDashboardSnapshot();
      }
      throw databaseError('load dashboard source snapshot', error);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const snapshot = data as Record<string, unknown>;
    return {
      allBatches: this.decodeSnapshotRows('materialBatches', snapshot.materialBatches),
      allTransfers: this.decodeSnapshotRows('transfers', snapshot.transfers),
      measurements: this.decodeSnapshotRows('measurements', snapshot.measurements),
      recoveryRecords: this.decodeSnapshotRows('recoveryRecords', snapshot.recoveryRecords),
      listings: this.decodeSnapshotRows('listings', snapshot.listings),
      offers: this.decodeSnapshotRows('offers', snapshot.offers),
      users: this.decodeSnapshotRows('users', snapshot.users),
      organizations: this.decodeSnapshotRows('organizations', snapshot.organizations),
      facilities: this.decodeSnapshotRows('facilities', snapshot.facilities),
      walletEntries: this.decodeSnapshotRows('walletEntries', snapshot.walletEntries),
      interactions: this.decodeSnapshotRows('systemInteractions', snapshot.systemInteractions),
    };
  }

  private async loadPagedDashboardSnapshot(): Promise<DashboardSourceSnapshot> {
    const names = ['materialBatches', 'transfers', 'measurements', 'recoveryRecords', 'listings', 'offers',
      'users', 'organizations', 'facilities', 'walletEntries', 'systemInteractions'] as const;
    const tables = [...names.map(name => this.table(name)), 'flow_events', 'auth_account_security'];
    const raw = new Map<string, Row[]>();
    // Two workers bound database pressure; no correlated joins or repeated enrichment scans.
    let next = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (next < tables.length) {
        const table = tables[next++];
        const rows: Row[] = [];
        let cursor: string | undefined;
        for (;;) {
          let query = this.client.from(table).select('*').order('id').limit(500);
          if (cursor !== undefined) query = query.gt('id', cursor);
          const { data, error } = await query;
          if (error) throw databaseError(`read ${table}`, error);
          const page = (data ?? []) as Row[];
          rows.push(...page);
          if (!page.length) break;
          const last = page[page.length - 1].id;
          if (last === cursor) throw databaseError(`read ${table}`, { message: 'Pagination did not advance.' });
          cursor = last;
        }
        raw.set(table, rows);
      }
    }));
    const rows = (name: typeof names[number]) => raw.get(this.table(name))!;
    const byId = (values: Row[], key = 'id') => new Map(values.map(row => [row[key], row]));
    const batches = byId(rows('materialBatches'));
    const listings = byId(rows('listings'));
    const users = byId(rows('users'));
    const security = byId(raw.get('auth_account_security')!, 'user_id');
    const groupByTransfer = (values: Row[]) => {
      const grouped = new Map<unknown, Row[]>();
      for (const row of values) {
        const group = grouped.get(row.transfer_id) ?? [];
        group.push(row); grouped.set(row.transfer_id, group);
      }
      return grouped;
    };
    const measurements = groupByTransfer(rows('measurements'));
    const events = groupByTransfer(raw.get('flow_events')!);
    for (const group of events.values()) group.sort((a, b) => Number(a.sequence) - Number(b.sequence));
    const decode = <K extends typeof names[number]>(name: K): RecordFor<K>[] => rows(name).map(row => {
      const document: Record<string, unknown> = toDocument(row);
      if (name === 'listings') document._batch = batches.get(row.batch_id);
      if (name === 'offers') {
        document._listing = listings.get(row.listing_id);
        document._requester = users.get(row.requester_id);
      }
      if (name === 'users') document._security = security.get(row.id);
      if (name === 'transfers') {
        document._flow_events = events.get(row.id) ?? [];
        document._measurements = measurements.get(row.id) ?? [];
      }
      return rememberCanonicalRow(decodeRecord(name, document), document) as RecordFor<K>;
    });
    return { allBatches: decode('materialBatches'), allTransfers: decode('transfers'), measurements: decode('measurements'),
      recoveryRecords: decode('recoveryRecords'), listings: decode('listings'), offers: decode('offers'), users: decode('users'),
      organizations: decode('organizations'), facilities: decode('facilities'), walletEntries: decode('walletEntries'), interactions: decode('systemInteractions') };
  }

  private decodeSnapshotRows<K extends CollectionName>(name: K, value: unknown): RecordFor<K>[] {
    if (!Array.isArray(value)) return [];
    return value.map((row) => decodeRecord(name, toDocument(row as Row))) as RecordFor<K>[];
  }

  private async enrich<K extends CollectionName>(name: K, documents: Record<string, unknown>[]) {
    if (!documents.length) return;
    if (name === 'users') await this.attach(documents, 'auth_account_security', 'user_id', '_security', documents.map(itemId));
    if (name === 'listings') await this.attach(documents, 'material_batches', 'id', '_batch', documents.map((document) => String(document.batch_id ?? '')));
    if (name === 'offers') {
      await this.attach(documents, 'listings', 'id', '_listing', documents.map((document) => String(document.listing_id ?? '')));
      await this.attach(documents, 'users', 'id', '_requester', documents.map((document) => String(document.requester_id ?? '')));
    }
    if (name === 'transfers') {
      const ids = documents.map(itemId);
      const [events, measurements] = await Promise.all([
        this.selectIn('flow_events', 'transfer_id', ids, { column: 'sequence', ascending: true }),
        this.selectIn('measurements', 'transfer_id', ids),
      ]);
      for (const document of documents) {
        document._flow_events = events.filter((event) => event.transfer_id === document._id);
        document._measurements = measurements.filter((measurement) => measurement.transfer_id === document._id);
      }
    }
    if (name === 'conversations') await this.attach(documents, 'listings', 'id', '_listing', documents.map((document) => String(document.listing_id ?? '')));
    if (name === 'messages') await this.attach(documents, 'users', 'id', '_sender', documents.map((document) => String(document.sender_id ?? '')));
  }

  private async attach(documents: Record<string, unknown>[], table: string, lookupColumn: string, target: string, ids: string[]) {
    const rows = await this.selectIn(table, lookupColumn, ids.filter(Boolean));
    const byId = new Map(rows.map((row) => [String(row[lookupColumn]), toDocument(row)]));
    for (const document of documents) {
      const sourceColumn = target === '_security' ? '_id' : target === '_batch' ? 'batch_id' : target === '_requester' ? 'requester_id' : target === '_sender' ? 'sender_id' : 'listing_id';
      document[target] = byId.get(String(document[sourceColumn] ?? ''));
    }
  }

  private async selectIn(table: string, column: string, ids: string[], order?: { column: string; ascending: boolean }) {
    if (!ids.length) return [] as Row[];
    const uniqueIds = [...new Set(ids)];
    const rows: Row[] = [];
    for (let index = 0; index < uniqueIds.length; index += 100) {
      let query = this.client.from(table).select('*').in(column, uniqueIds.slice(index, index + 100)).limit(1_000);
      if (order) query = query.order(order.column, { ascending: order.ascending });
      const { data, error } = await query;
      if (error) throw databaseError(`enrich from ${table}`, error);
      rows.push(...((data ?? []) as Row[]));
    }
    return rows;
  }

  private async syncFlowEvents(transfer: RecordFor<'transfers'>) {
    if (!transfer.events.length) return;
    const rows = transfer.events.map((event, index) => toRow(encodeFlowEvent(transfer.id, transfer.batchId, transfer.listingId, event, index + 1)));
    const { error } = await this.client.from('flow_events').upsert(rows, { onConflict: 'id' });
    if (error) throw databaseError('synchronize flow events', error);
  }

  private async syncUserSecurity(user: RecordFor<'users'>) {
    const row = {
      id: `AAS-${user.id}`, user_id: user.id, email_verified_at: user.emailVerifiedAt,
      password_changed_at: user.passwordChangedAt, updated_at: new Date().toISOString(),
    };
    const { error } = await this.client.from('auth_account_security').upsert(row, { onConflict: 'user_id', ignoreDuplicates: false });
    if (error) throw databaseError('synchronize user security', error);
  }

  async close() {}
}

function toRow(document: Record<string, unknown>) {
  const { _id, ...values } = document;
  return normalize({ id: String(_id), ...values }) as Row;
}

function toDocument(row: Record<string, unknown>) { return { ...row, _id: row.id }; }
function itemId(document: Record<string, unknown>) { return String(document._id ?? ''); }
function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
}

function decodeSession(row: Record<string, unknown>): AuthSessionRecord {
  return {
    id: String(row.id), userId: String(row.user_id), client: row.client as AuthSessionRecord['client'], tokenHash: String(row.token_hash),
    usedTokenHashes: Array.isArray(row.used_token_hashes) ? row.used_token_hashes.map(String) : [], csrfHash: String(row.csrf_hash),
    expiresAt: new Date(String(row.expires_at)).toISOString(), revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function decodeChallenge(row: Record<string, unknown>): AuthChallengeRecord {
  return {
    id: String(row.id), userId: String(row.user_id), type: row.type as AuthChallengeRecord['type'], tokenHash: String(row.token_hash), client: row.client as AuthChallengeRecord['client'],
    expiresAt: new Date(String(row.expires_at)).toISOString(), consumedAt: row.consumed_at ? new Date(String(row.consumed_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function decodeRateLimit(row: Record<string, unknown>): AuthRateLimitRecord {
  return {
    id: String(row.id), scope: row.scope as AuthRateLimitRecord['scope'], subjectHash: String(row.subject_hash), attempts: Number(row.attempts),
    windowStartedAt: new Date(String(row.window_started_at)).toISOString(), lockedUntil: row.locked_until ? new Date(String(row.locked_until)).toISOString() : null,
    expiresAt: new Date(String(row.expires_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function databaseError(operation: string, error: { message: string; code?: string; details?: string }) {
  return new DatabaseOperationError(operation, error);
}
