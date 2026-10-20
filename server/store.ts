import { MongoClient, type Db, type Document } from 'mongodb';
import { canonicalMutations, rememberCanonicalRow, MutationConflict, type RecordMutation } from './database/mutations.js';
import { decodeRecord, encodeFlowEvent, encodeRecord } from './database/codecs.js';
import { mongoClientOptionsFromEnv } from './database/mongoClientOptions.js';
import { DATABASE_COLLECTIONS, WEB_PERSISTENCE_COLLECTION_MAP } from './database/schema.js';
import { SupabaseStore } from './supabaseStore.js';
import type { ImportExistingRecord, ImportRecordLookup } from '../shared/imports.js';
import type { AuthChallengeRecord, AuthRateLimitRecord, AuthSessionRecord, DatabaseShape } from './types.js';

type CollectionName = keyof DatabaseShape;
type RecordFor<K extends CollectionName> = DatabaseShape[K][number];
interface CanonicalDocument extends Document { _id: string }

export interface DashboardSourceSnapshot {
  hubDisposals?: { available: boolean; records: import('../shared/hubs.js').HubDisposalRecord[] };
  allBatches: DatabaseShape['materialBatches'];
  allTransfers: DatabaseShape['transfers'];
  measurements: DatabaseShape['measurements'];
  recoveryRecords: DatabaseShape['recoveryRecords'];
  listings: DatabaseShape['listings'];
  offers: DatabaseShape['offers'];
  users: DatabaseShape['users'];
  organizations: DatabaseShape['organizations'];
  facilities: DatabaseShape['facilities'];
  walletEntries: DatabaseShape['walletEntries'];
  interactions: DatabaseShape['systemInteractions'];
}

export interface Store {
  mode: 'supabase' | 'mongodb' | 'memory-demo';
  all<K extends CollectionName>(name: K): Promise<RecordFor<K>[]>;
  findById<K extends CollectionName>(name: K, id: string): Promise<RecordFor<K> | null>;
  findOne<K extends CollectionName>(name: K, predicate: (record: RecordFor<K>) => boolean): Promise<RecordFor<K> | null>;
  insert<K extends CollectionName>(name: K, record: RecordFor<K>): Promise<RecordFor<K>>;
  update<K extends CollectionName>(name: K, id: string, patch: Partial<RecordFor<K>>): Promise<RecordFor<K> | null>;
  commit(mutations: RecordMutation[]): Promise<void>;
  createSession(session: AuthSessionRecord): Promise<AuthSessionRecord>;
  findSession(id: string): Promise<AuthSessionRecord | null>;
  listUserSessions(userId: string): Promise<AuthSessionRecord[]>;
  rotateSessionToken(id: string, presentedHash: string, nextHash: string, nextCsrfHash: string, updatedAt: string): Promise<'rotated' | 'replayed' | 'invalid'>;
  revokeSession(id: string, userId: string, revokedAt: string): Promise<boolean>;
  revokeUserSessions(userId: string, revokedAt: string): Promise<number>;
  createAuthChallenge(challenge: AuthChallengeRecord): Promise<AuthChallengeRecord>;
  consumeAuthChallenge(tokenHash: string, type: AuthChallengeRecord['type'], consumedAt: string): Promise<AuthChallengeRecord | null>;
  invalidateAuthChallenges(userId: string, type: AuthChallengeRecord['type'], consumedAt: string): Promise<number>;
  findRateLimit(id: string): Promise<AuthRateLimitRecord | null>;
  recordRateLimitFailure(id: string, scope: AuthRateLimitRecord['scope'], subjectHash: string, now: string, windowSeconds: number, maxAttempts: number, lockSeconds: number): Promise<AuthRateLimitRecord>;
  clearRateLimit(id: string): Promise<void>;
  loadDashboardSnapshot?(): Promise<DashboardSourceSnapshot | null>;
  lookupImportRecords?(lookups: ImportRecordLookup[]): Promise<ImportExistingRecord[]>;
  loadHubDisposals?(): Promise<{ available: boolean; records: import('../shared/hubs.js').HubDisposalRecord[] }>;
  loadReportExportEvents?(start: string, endExclusive: string): Promise<DatabaseShape['auditRecords']>;
  hasHubActivity?(userId: string): Promise<boolean>;
  close(): Promise<void>;
}

export class MemoryStore implements Store {
  mode = 'memory-demo' as const;
  private sessions = new Map<string, AuthSessionRecord>();
  private challenges = new Map<string, AuthChallengeRecord>();
  private rateLimits = new Map<string, AuthRateLimitRecord>();
  constructor(private data: DatabaseShape) {}

  async all<K extends CollectionName>(name: K) {
    return [...this.data[name]] as RecordFor<K>[];
  }

  async findById<K extends CollectionName>(name: K, id: string) {
    return (this.data[name] as RecordFor<K>[]).find((record) => record.id === id) ?? null;
  }

  async findOne<K extends CollectionName>(name: K, predicate: (record: RecordFor<K>) => boolean) {
    return (this.data[name] as RecordFor<K>[]).find(predicate) ?? null;
  }

  async insert<K extends CollectionName>(name: K, record: RecordFor<K>) {
    (this.data[name] as RecordFor<K>[]).push(record);
    return record;
  }

  async update<K extends CollectionName>(name: K, id: string, patch: Partial<RecordFor<K>>) {
    const records = this.data[name] as RecordFor<K>[];
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) return null;
    records[index] = { ...records[index], ...patch };
    return records[index];
  }

  async createSession(session: AuthSessionRecord) {
    this.sessions.set(session.id, session);
    return session;
  }

  async findSession(id: string) { return this.sessions.get(id) ?? null; }

  async listUserSessions(userId: string) {
    return [...this.sessions.values()].filter((session) => session.userId === userId);
  }

  async rotateSessionToken(id: string, presentedHash: string, nextHash: string, nextCsrfHash: string, updatedAt: string) {
    const session = this.sessions.get(id);
    if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) return 'invalid' as const;
    if (session.usedTokenHashes.includes(presentedHash)) {
      this.sessions.set(id, { ...session, revokedAt: updatedAt, updatedAt });
      return 'replayed' as const;
    }
    if (session.tokenHash !== presentedHash) return 'invalid' as const;
    this.sessions.set(id, { ...session, tokenHash: nextHash, csrfHash: nextCsrfHash, usedTokenHashes: [...session.usedTokenHashes, presentedHash].slice(-20), updatedAt });
    return 'rotated' as const;
  }

  async revokeSession(id: string, userId: string, revokedAt: string) {
    const session = this.sessions.get(id);
    if (!session || session.userId !== userId || session.revokedAt) return false;
    this.sessions.set(id, { ...session, revokedAt, updatedAt: revokedAt });
    return true;
  }

  async revokeUserSessions(userId: string, revokedAt: string) {
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (session.userId === userId && !session.revokedAt) {
        this.sessions.set(id, { ...session, revokedAt, updatedAt: revokedAt });
        count += 1;
      }
    }
    return count;
  }

  async createAuthChallenge(challenge: AuthChallengeRecord) {
    if (this.challenges.has(challenge.id) || [...this.challenges.values()].some(item => item.tokenHash === challenge.tokenHash)) throw new MutationConflict();
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  async consumeAuthChallenge(tokenHash: string, type: AuthChallengeRecord['type'], consumedAt: string) {
    const challenge = [...this.challenges.values()].find((item) => item.tokenHash === tokenHash && item.type === type && !item.consumedAt && new Date(item.expiresAt).getTime() > Date.now());
    if (!challenge) return null;
    const consumed = { ...challenge, consumedAt, updatedAt: consumedAt };
    this.challenges.set(challenge.id, consumed);
    return consumed;
  }

  async invalidateAuthChallenges(userId: string, type: AuthChallengeRecord['type'], consumedAt: string) {
    let count = 0;
    for (const [id, challenge] of this.challenges) {
      if (challenge.userId === userId && challenge.type === type && !challenge.consumedAt) {
        this.challenges.set(id, { ...challenge, consumedAt, updatedAt: consumedAt });
        count += 1;
      }
    }
    return count;
  }

  async findRateLimit(id: string) { return this.rateLimits.get(id) ?? null; }

  async recordRateLimitFailure(id: string, scope: AuthRateLimitRecord['scope'], subjectHash: string, now: string, windowSeconds: number, maxAttempts: number, lockSeconds: number) {
    const at = new Date(now);
    const existing = this.rateLimits.get(id);
    const withinWindow = existing && new Date(existing.windowStartedAt).getTime() > at.getTime() - windowSeconds * 1000;
    const attempts = withinWindow ? existing.attempts + 1 : 1;
    const lockedUntil = attempts >= maxAttempts ? new Date(at.getTime() + lockSeconds * 1000).toISOString() : withinWindow ? existing.lockedUntil : null;
    const record: AuthRateLimitRecord = { id, scope, subjectHash, attempts, windowStartedAt: withinWindow ? existing.windowStartedAt : now, lockedUntil, expiresAt: new Date(at.getTime() + Math.max(windowSeconds, lockSeconds) * 2000).toISOString(), updatedAt: now };
    this.rateLimits.set(id, record);
    return record;
  }

  async clearRateLimit(id: string) { this.rateLimits.delete(id); }

  async commit(mutations: RecordMutation[]) {
    const staged = structuredClone(this.data);
    for (const mutation of mutations) {
      const records = staged[mutation.name] as Array<{ id: string }>;
      const index = records.findIndex(record => record.id === mutation.record.id);
      if (mutation.previous) {
        if (index < 0 || JSON.stringify(records[index]) !== JSON.stringify(mutation.previous)) throw new MutationConflict();
        records[index] = structuredClone(mutation.record);
      } else {
        if (index >= 0) throw new MutationConflict();
        records.push(structuredClone(mutation.record));
      }
    }
    if(this.data.users.some(user=>user.role==='Administrator' && user.accountStatus==='Active') && !staged.users.some(user=>user.role==='Administrator' && user.accountStatus==='Active')) throw new MutationConflict();
    this.data = staged;
  }

  async close() {}
}

class MongoStore implements Store {
  mode = 'mongodb' as const;
  constructor(private db: Db, private client: MongoClient) {}

  async loadReportExportEvents(start: string, endExclusive: string) {
    const rows = await this.collection('auditRecords').find({ action: 'report.exported',
      occurred_at: { $gte: new Date(start), $lt: new Date(endExclusive) } }).toArray();
    return rows.map(row => decodeRecord('auditRecords', row));
  }

  private collection<K extends CollectionName>(name: K) {
    return this.db.collection<CanonicalDocument>(WEB_PERSISTENCE_COLLECTION_MAP[name]);
  }

  async commit(mutations: RecordMutation[]) {
    const operations = canonicalMutations(mutations);
    await this.client.withSession(async session => {
      await session.withTransaction(async () => {
        for (const operation of operations) {
          const collection = this.db.collection<CanonicalDocument>(operation.table);
          const definition=DATABASE_COLLECTIONS.find(item=>item.name===operation.table);
          const properties=(definition?.validator.$jsonSchema as {properties?:Record<string,{bsonType?:string|string[]}>}|undefined)?.properties ?? {};
          const values=Object.fromEntries(Object.entries(operation.values).map(([key,value])=>{
            const type=properties[key]?.bsonType;
            return [key,value!==null && (type==='date'||Array.isArray(type)&&type.includes('date'))?new Date(String(value)):value];
          }));
          if (operation.mode === 'insert') {
            await collection.insertOne({ _id: operation.id, ...values }, { session });
          } else {
            const result = await collection.updateOne({ _id: operation.id, ...operation.expected }, { $set: values }, { session, upsert: operation.mode === 'upsert' });
            if (operation.mode === 'update' && !result.matchedCount) throw new MutationConflict();
          }
        }
      });
    });
  }

  async all<K extends CollectionName>(name: K) {
    const query = name === 'configurations' ? { status: 'active' } : {};
    const documents = await this.collection(name).find(query).toArray();
    await this.enrich(name, documents);
    return documents.map((document) => rememberCanonicalRow(decodeRecord(name, document),document)) as RecordFor<K>[];
  }

  async findById<K extends CollectionName>(name: K, id: string) {
    const canonicalId = name === 'configurations' ? `CFG-${id}-v1` : id;
    const document = await this.collection(name).findOne({ _id: canonicalId });
    if (!document) return null;
    await this.enrich(name, [document]);
    return rememberCanonicalRow(decodeRecord(name, document),document) as RecordFor<K>;
  }

  async findOne<K extends CollectionName>(name: K, predicate: (record: RecordFor<K>) => boolean) {
    const records = await this.all(name);
    return records.find(predicate) ?? null;
  }

  async insert<K extends CollectionName>(name: K, record: RecordFor<K>) {
    await this.collection(name).insertOne(encodeRecord(name, record) as CanonicalDocument);
    if (name === 'users') await this.syncUserSecurity(record as RecordFor<'users'>);
    if (name === 'transfers') await this.syncFlowEvents(record as RecordFor<'transfers'>);
    return record;
  }

  async update<K extends CollectionName>(name: K, id: string, patch: Partial<RecordFor<K>>) {
    const canonicalId = name === 'configurations' ? `CFG-${id}-v1` : id;
    const existingDocument = await this.collection(name).findOne({ _id: canonicalId });
    const existingRecord = await this.findOne(name, (record) => record.id === id);
    if (!existingDocument || !existingRecord) return null;
    const merged = { ...existingRecord, ...patch } as RecordFor<K>;
    const encoded = encodeRecord(name, merged) as CanonicalDocument;
    if (existingDocument.created_at) encoded.created_at = existingDocument.created_at;
    if (name === 'users') {
      delete existingDocument.email_verified_at;
      delete existingDocument.password_changed_at;
    }
    await this.collection(name).replaceOne({ _id: canonicalId }, { ...existingDocument, ...encoded, _id: canonicalId });
    if (name === 'users') await this.syncUserSecurity(merged as RecordFor<'users'>);
    if (name === 'transfers') await this.syncFlowEvents(merged as RecordFor<'transfers'>);
    return this.findOne(name, (record) => record.id === id);
  }

  async createSession(session: AuthSessionRecord) {
    await this.db.collection<CanonicalDocument>('sessions').insertOne({
      _id: session.id,
      user_id: session.userId,
      client: session.client,
      token_hash: session.tokenHash,
      used_token_hashes: session.usedTokenHashes,
      csrf_hash: session.csrfHash,
      expires_at: new Date(session.expiresAt),
      revoked_at: session.revokedAt ? new Date(session.revokedAt) : null,
      created_at: new Date(session.createdAt),
      updated_at: new Date(session.updatedAt),
    });
    return session;
  }

  async findSession(id: string) {
    const document = await this.db.collection<CanonicalDocument>('sessions').findOne({ _id: id });
    if (!document) return null;
    return {
      id: String(document._id),
      userId: String(document.user_id),
      client: document.client as AuthSessionRecord['client'],
      tokenHash: String(document.token_hash),
      usedTokenHashes: Array.isArray(document.used_token_hashes) ? document.used_token_hashes.map(String) : [],
      csrfHash: String(document.csrf_hash),
      expiresAt: new Date(document.expires_at).toISOString(),
      revokedAt: document.revoked_at ? new Date(document.revoked_at).toISOString() : null,
      createdAt: new Date(document.created_at).toISOString(),
      updatedAt: new Date(document.updated_at).toISOString(),
    };
  }

  async listUserSessions(userId: string) {
    const documents = await this.db.collection<CanonicalDocument>('sessions').find({ user_id: userId }).sort({ created_at: -1 }).toArray();
    return Promise.all(documents.map((document) => this.findSession(String(document._id)))).then((sessions) => sessions.filter((session): session is AuthSessionRecord => Boolean(session)));
  }

  async rotateSessionToken(id: string, presentedHash: string, nextHash: string, nextCsrfHash: string, updatedAt: string) {
    const now = new Date();
    const result = await this.db.collection<CanonicalDocument>('sessions').updateOne(
      { _id: id, token_hash: presentedHash, revoked_at: null, expires_at: { $gt: now } },
      {
        $set: { token_hash: nextHash, csrf_hash: nextCsrfHash, updated_at: new Date(updatedAt) },
        $push: { used_token_hashes: { $each: [presentedHash], $slice: -20 } },
      } as Document,
    );
    if (result.modifiedCount === 1) return 'rotated' as const;
    const replayed = await this.db.collection<CanonicalDocument>('sessions').findOne({ _id: id, used_token_hashes: presentedHash, revoked_at: null, expires_at: { $gt: now } });
    if (!replayed) return 'invalid' as const;
    await this.db.collection<CanonicalDocument>('sessions').updateOne({ _id: id, revoked_at: null }, { $set: { revoked_at: new Date(updatedAt), updated_at: new Date(updatedAt) } });
    return 'replayed' as const;
  }

  async revokeSession(id: string, userId: string, revokedAt: string) {
    const result = await this.db.collection<CanonicalDocument>('sessions').updateOne(
      { _id: id, user_id: userId, revoked_at: null },
      { $set: { revoked_at: new Date(revokedAt), updated_at: new Date(revokedAt) } },
    );
    return result.modifiedCount === 1;
  }

  async revokeUserSessions(userId: string, revokedAt: string) {
    const result = await this.db.collection<CanonicalDocument>('sessions').updateMany(
      { user_id: userId, revoked_at: null },
      { $set: { revoked_at: new Date(revokedAt), updated_at: new Date(revokedAt) } },
    );
    return result.modifiedCount;
  }

  async createAuthChallenge(challenge: AuthChallengeRecord) {
    await this.db.collection<CanonicalDocument>('auth_challenges').insertOne({
      _id: challenge.id, user_id: challenge.userId, type: challenge.type, token_hash: challenge.tokenHash, client: challenge.client,
      expires_at: new Date(challenge.expiresAt), consumed_at: challenge.consumedAt ? new Date(challenge.consumedAt) : null,
      created_at: new Date(challenge.createdAt), updated_at: new Date(challenge.updatedAt),
    });
    return challenge;
  }

  async consumeAuthChallenge(tokenHash: string, type: AuthChallengeRecord['type'], consumedAt: string) {
    const document = await this.db.collection<CanonicalDocument>('auth_challenges').findOneAndUpdate(
      { token_hash: tokenHash, type, consumed_at: null, expires_at: { $gt: new Date() } },
      { $set: { consumed_at: new Date(consumedAt), updated_at: new Date(consumedAt) } },
      { returnDocument: 'after' },
    );
    return document ? decodeChallenge(document) : null;
  }

  async invalidateAuthChallenges(userId: string, type: AuthChallengeRecord['type'], consumedAt: string) {
    const result = await this.db.collection<CanonicalDocument>('auth_challenges').updateMany(
      { user_id: userId, type, consumed_at: null },
      { $set: { consumed_at: new Date(consumedAt), updated_at: new Date(consumedAt) } },
    );
    return result.modifiedCount;
  }

  async findRateLimit(id: string) {
    const document = await this.db.collection<CanonicalDocument>('auth_rate_limits').findOne({ _id: id });
    return document ? decodeRateLimit(document) : null;
  }

  async recordRateLimitFailure(id: string, scope: AuthRateLimitRecord['scope'], subjectHash: string, now: string, windowSeconds: number, maxAttempts: number, lockSeconds: number) {
    const at = new Date(now);
    const collection = this.db.collection<CanonicalDocument>('auth_rate_limits');
    await collection.updateOne(
      { _id: id, window_started_at: { $lte: new Date(at.getTime() - windowSeconds * 1000) } },
      { $set: { attempts: 0, window_started_at: at, locked_until: null } },
    );
    const document = await collection.findOneAndUpdate(
      { _id: id },
      {
        $inc: { attempts: 1 },
        $set: { scope, subject_hash: subjectHash, expires_at: new Date(at.getTime() + Math.max(windowSeconds, lockSeconds) * 2000), updated_at: at },
        $setOnInsert: { window_started_at: at, locked_until: null },
      } as Document,
      { upsert: true, returnDocument: 'after' },
    );
    if (!document) throw new Error('Authentication rate-limit state could not be recorded.');
    if (Number(document.attempts) >= maxAttempts && (!document.locked_until || new Date(document.locked_until).getTime() <= at.getTime())) {
      const lockedUntil = new Date(at.getTime() + lockSeconds * 1000);
      await collection.updateOne({ _id: id }, { $set: { locked_until: lockedUntil, updated_at: at } });
      document.locked_until = lockedUntil;
    }
    return decodeRateLimit(document);
  }

  async clearRateLimit(id: string) { await this.db.collection<CanonicalDocument>('auth_rate_limits').deleteOne({ _id: id }); }

  private async enrich<K extends CollectionName>(name: K, documents: Document[]) {
    if (!documents.length) return;

    if (name === 'users') {
      const userIds = documents.map((document) => String(document._id));
      const securityRecords = await this.db.collection<CanonicalDocument>('auth_account_security').find({ user_id: { $in: userIds } }).toArray();
      const byUserId = new Map(securityRecords.map((record) => [String(record.user_id), record]));
      for (const document of documents) document._security = byUserId.get(String(document._id));
    }

    if (name === 'listings') {
      const batchIds = [...new Set(documents.map((document) => document.batch_id).filter(Boolean))];
      const batches = await this.db.collection<CanonicalDocument>('material_batches').find({ _id: { $in: batchIds } }).toArray();
      const byId = new Map(batches.map((batch) => [String(batch._id), batch]));
      for (const document of documents) document._batch = byId.get(String(document.batch_id));
    }

    if (name === 'offers') {
      const listingIds = [...new Set(documents.map((document) => document.listing_id).filter(Boolean))];
      const requesterIds = [...new Set(documents.map((document) => document.requester_id).filter(Boolean))];
      const [listings, users] = await Promise.all([
        this.db.collection<CanonicalDocument>('listings').find({ _id: { $in: listingIds } }).toArray(),
        this.db.collection<CanonicalDocument>('users').find({ _id: { $in: requesterIds } }).toArray(),
      ]);
      const listingById = new Map(listings.map((item) => [String(item._id), item]));
      const userById = new Map(users.map((item) => [String(item._id), item]));
      for (const document of documents) { document._listing = listingById.get(String(document.listing_id)); document._requester = userById.get(String(document.requester_id)); }
    }

    if (name === 'transfers') {
      const transferIds = documents.map((document) => String(document._id));
      const [events, measurements] = await Promise.all([
        this.db.collection('flow_events').find({ transfer_id: { $in: transferIds } }).sort({ sequence: 1 }).toArray(),
        this.db.collection('measurements').find({ transfer_id: { $in: transferIds } }).toArray(),
      ]);
      for (const document of documents) {
        document._flow_events = events.filter((event) => event.transfer_id === document._id);
        document._measurements = measurements.filter((measurement) => measurement.transfer_id === document._id);
      }
    }

    if (name === 'conversations') {
      const listingIds = [...new Set(documents.map((document) => document.listing_id).filter(Boolean))];
      const listings = await this.db.collection<CanonicalDocument>('listings').find({ _id: { $in: listingIds } }).toArray();
      const byId = new Map(listings.map((listing) => [String(listing._id), listing]));
      for (const document of documents) document._listing = byId.get(String(document.listing_id));
    }

    if (name === 'messages') {
      const senderIds = [...new Set(documents.map((document) => document.sender_id).filter(Boolean))];
      const users = await this.db.collection<CanonicalDocument>('users').find({ _id: { $in: senderIds } }).toArray();
      const byId = new Map(users.map((user) => [String(user._id), user]));
      for (const document of documents) document._sender = byId.get(String(document.sender_id));
    }
  }

  private async syncFlowEvents(transfer: RecordFor<'transfers'>) {
    if (!transfer.events.length) return;
    await this.db.collection<CanonicalDocument>('flow_events').bulkWrite(transfer.events.map((event, index) => ({
      replaceOne: { filter: { _id: event.id }, replacement: encodeFlowEvent(transfer.id, transfer.batchId, transfer.listingId, event, index + 1) as CanonicalDocument, upsert: true },
    })));
  }

  private async syncUserSecurity(user: RecordFor<'users'>) {
    const collection = this.db.collection<CanonicalDocument>('auth_account_security');
    const existing = await collection.findOne({ user_id: user.id });
    await collection.replaceOne(
      { user_id: user.id },
      {
        _id: existing?._id ?? `AAS-${user.id}`,
        user_id: user.id,
        email_verified_at: user.emailVerifiedAt ? new Date(user.emailVerifiedAt) : null,
        password_changed_at: user.passwordChangedAt ? new Date(user.passwordChangedAt) : null,
        created_at: existing?.created_at ?? new Date(),
        updated_at: new Date(),
      },
      { upsert: true },
    );
  }

  async close() { await this.client.close(); }
}

function decodeChallenge(document: Document): AuthChallengeRecord {
  return {
    id: String(document._id), userId: String(document.user_id), type: document.type, tokenHash: String(document.token_hash), client: document.client,
    expiresAt: new Date(document.expires_at).toISOString(), consumedAt: document.consumed_at ? new Date(document.consumed_at).toISOString() : null,
    createdAt: new Date(document.created_at).toISOString(), updatedAt: new Date(document.updated_at).toISOString(),
  };
}

function decodeRateLimit(document: Document): AuthRateLimitRecord {
  return {
    id: String(document._id), scope: document.scope, subjectHash: String(document.subject_hash), attempts: Number(document.attempts),
    windowStartedAt: new Date(document.window_started_at).toISOString(), lockedUntil: document.locked_until ? new Date(document.locked_until).toISOString() : null,
    expiresAt: new Date(document.expires_at).toISOString(), updatedAt: new Date(document.updated_at).toISOString(),
  };
}

export async function createStore(seed: DatabaseShape): Promise<Store> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl || supabaseSecretKey) {
    if (!supabaseUrl || !supabaseSecretKey) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be configured together.');
    return new SupabaseStore(supabaseUrl, supabaseSecretKey);
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) return new MemoryStore(seed);

  const client = new MongoClient(uri, mongoClientOptionsFromEnv());
  await client.connect();
  const db = client.db(process.env.MONGODB_DB ?? 'baliktela');
  return new MongoStore(db, client);
}
