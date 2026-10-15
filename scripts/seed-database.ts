import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { MongoClient, type Document } from 'mongodb';
import { mongoClientOptionsFromEnv } from '../server/database/mongoClientOptions.js';
import { createSeedData } from '../server/seed.js';
import { createStore } from '../server/store.js';
import type { DatabaseShape } from '../server/types.js';

type CollectionName = keyof DatabaseShape;

if (process.env.DATABASE_SEED_DEMO !== 'true' && process.env.MONGODB_SEED_DEMO !== 'true') {
  console.error('Refusing to seed. Set DATABASE_SEED_DEMO=true for an intentional demo-data operation.');
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if ((!supabaseUrl || !supabaseKey) && (!uri || !databaseName)) {
  console.error('Configure SUPABASE_URL and SUPABASE_SECRET_KEY, or the legacy MongoDB connection.');
  process.exit(1);
}

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const inspector = !supabase ? new MongoClient(uri!, mongoClientOptionsFromEnv()) : null;
if (inspector) await inspector.connect();
const db = inspector?.db(databaseName);
const existingUsers = supabase
  ? await supabase.from('users').select('id', { count: 'exact', head: true }).then(({ count, error }) => { if (error) throw error; return count ?? 0; })
  : await db!.collection('users').countDocuments();
if (existingUsers) {
  await inspector?.close();
  console.error(`Refusing to seed ${supabase ? 'Supabase' : databaseName}: users already contains ${existingUsers} records.`);
  process.exit(1);
}
await inspector?.close();

const seed = await createSeedData();
process.env.MONGODB_SEED_DEMO = 'false';
process.env.DATABASE_SEED_DEMO = 'false';
const store = await createStore(seed);

try {
  for (const [name, records] of Object.entries(seed) as [CollectionName, DatabaseShape[CollectionName]][]) {
    for (const record of records) await store.insert(name, record as never);
  }
} finally {
  await store.close();
}

const client = !supabase ? new MongoClient(uri!, mongoClientOptionsFromEnv()) : null;
if (client) await client.connect();
const canonical = client?.db(databaseName);
const at = new Date('2026-09-21T08:00:00.000Z');

const supplementary: Record<string, Document[]> = {
  consent_history: seed.users.map((user) => ({
    _id: `CNS-${user.id}-001`, user_id: user.id, privacy: true, research: user.role === 'Researcher', policy_version: 'pilot-v1', recorded_by: user.id, source: user.role === 'Consumer' ? 'mobile' : 'administrator', created_at: new Date(user.consentAt),
  })),
  facility_assignments: [
    { _id: 'FAS-USR-REC-01-FAC-001', user_id: 'USR-REC-01', facility_id: 'FAC-001', role: 'verifier', active: true, assigned_by: 'USR-ADMIN-01', created_at: at, updated_at: at },
    { _id: 'FAS-USR-REC-01-FAC-002', user_id: 'USR-REC-01', facility_id: 'FAC-002', role: 'processor', active: true, assigned_by: 'USR-ADMIN-01', created_at: at, updated_at: at },
    { _id: 'FAS-USR-PROD-01-FAC-003', user_id: 'USR-PROD-01', facility_id: 'FAC-003', role: 'manager', active: true, assigned_by: 'USR-ADMIN-01', created_at: at, updated_at: at },
  ],
  collection_receipts: [{
    _id: 'CRP-2609-001', transfer_id: 'TRF-2609-001', batch_id: 'MB-2609-004', facility_id: 'FAC-001', facility_name: 'Green Loop Sorting Hub (demo)', source_user_id: 'USR-PROD-01', actor_id: 'USR-REC-01', measurement_id: 'MSR-MB-2609-004-RC', weight_kg: 89, weight_status: 'Measured', measurement_context: 'Receiving facility scale', note: 'Demo receipt with documented 2 kg variance.', created_at: new Date('2026-09-14T08:00:00.000Z'),
  }],
  reward_rules: [{
    _id: 'RWR-PILOT-001', title: 'Verified completed transfer pilot rule', points: 2, active: true, version: 1, eligibility: 'Measured or verified receipt followed by validated completion.', created_by: 'USR-ADMIN-01', approved_by: 'USR-ADMIN-01', created_at: at, updated_at: at,
  }],
  wallet_accounts: [
    { _id: 'WAL-USR-ADMIN-01', user_id: 'USR-ADMIN-01', balance_points: 1200, updated_at: at },
    { _id: 'WAL-USR-PROD-01', user_id: 'USR-PROD-01', balance_points: 178, updated_at: at },
  ],
  methodologies: [
    { _id: 'MTH-ENV-001', name: 'Environmental impact methodology', type: 'environmental_impact', version: 'unapproved', status: 'disabled', definition: {}, limitations: 'No approved factors or calculation methodology.', approved_by: null, approved_at: null, created_at: at, updated_at: at },
    { _id: 'MTH-PRED-001', name: 'Predictive analytics methodology', type: 'predictive', version: 'unapproved', status: 'disabled', definition: {}, limitations: 'No validated target, model, or evaluation criteria.', approved_by: null, approved_at: null, created_at: at, updated_at: at },
  ],
};

try {
  for (const [name, documents] of Object.entries(supplementary)) {
    if (!documents.length) continue;
    if (supabase) {
      const rows = documents.map(({ _id, ...document }) => normalize({ id: _id, ...document }));
      const { error } = await supabase.from(name).insert(rows);
      if (error) throw new Error(`Could not seed ${name}: ${error.message}`);
    } else {
      await canonical!.collection(name).insertMany(documents);
    }
  }
  console.log(JSON.stringify({ database: supabase ? 'supabase' : databaseName, seeded: Object.fromEntries((Object.keys(seed) as CollectionName[]).map((name) => [name, seed[name].length])), supplementary: Object.fromEntries(Object.entries(supplementary).map(([name, records]) => [name, records.length])) }, null, 2));
} finally {
  await client?.close();
}

function normalize(value: unknown): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
}
