import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { MongoClient, type Document } from 'mongodb';
import { mongoClientOptionsFromEnv } from '../server/database/mongoClientOptions.js';

interface StringIdDocument extends Document { _id: string }

if (process.env.DATABASE_SYNC_TEST !== 'true' && process.env.MONGODB_SYNC_TEST !== 'true') {
  console.error('Refusing to run. Set DATABASE_SYNC_TEST=true for an intentional synchronization test.');
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiUrl = (process.env.SYNC_TEST_API_URL ?? 'http://127.0.0.1:4000/api').replace(/\/$/, '');
if ((!supabaseUrl || !supabaseKey) && (!uri || !databaseName)) {
  console.error('Configure SUPABASE_URL and SUPABASE_SECRET_KEY, or the legacy MongoDB connection.');
  process.exit(1);
}

const suffix = randomUUID();
const batchId = `SYNC-MOBILE-BATCH-${suffix}`;
const measurementId = `SYNC-MOBILE-MSR-${suffix}`;
const listingId = `SYNC-MOBILE-LST-${suffix}`;
const now = new Date();
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const client = !supabase ? new MongoClient(uri!, mongoClientOptionsFromEnv()) : null;

if (client) await client.connect();
const db = client?.db(databaseName);

try {
  await insert('material_batches', {
    _id: batchId,
    source_user_id: 'USR-PROD-01',
    source_organization_id: 'ORG-PROD-01',
    material_category: 'Cotton blend',
    composition: 'Demo mobile synchronization record',
    waste_source: 'Pre-consumer',
    waste_form: 'Offcuts',
    condition: 'Recyclable',
    intended_pathway: 'Recycling',
    final_pathway: null,
    declared_weight_kg: 12.5,
    current_weight_kg: 12.5,
    weight_status: 'Measured',
    secondary_quantity: null,
    secondary_unit: null,
    location: { city: 'Quezon City', region: 'NCR', barangay: '', latitude: null, longitude: null },
    current_status: 'listed',
    current_custodian_id: 'USR-PROD-01',
    validation_status: 'pending',
    archived_at: null,
    created_at: now,
    updated_at: now,
  });

  await insert('measurements', {
    _id: measurementId,
    batch_id: batchId,
    transfer_id: null,
    facility_id: null,
    flow_event_id: null,
    stage: 'declaration',
    weight_kg: 12.5,
    weight_status: 'Measured',
    method: 'Mobile demo scale entry',
    measurement_context: 'Cross-client synchronization test',
    recorded_by: 'USR-PROD-01',
    verified_by: null,
    measured_at: now,
    note: 'Temporary test record; removed after verification.',
    supersedes_measurement_id: null,
    created_at: now,
  });

  await insert('listings', {
    _id: listingId,
    batch_id: batchId,
    owner_id: 'USR-PROD-01',
    owner_organization_id: 'ORG-PROD-01',
    owner_name: 'Demo Producer Cooperative',
    title: 'Mobile-to-web synchronization test',
    description: 'Temporary schema-compliant record created by the synchronization test.',
    looking_for: ['Recycling partner'],
    media: [],
    available_weight_kg: 12.5,
    reserved_kg: 0,
    category: 'Cotton blend',
    condition: 'Recyclable',
    location: 'Quezon City, NCR',
    city: 'Quezon City',
    region: 'NCR',
    weight_kg: 12.5,
    weight_status: 'Measured',
    waste_source: 'Pre-consumer',
    waste_form: 'Offcuts',
    pathway: 'Recycling',
    reward_points: 25,
    is_demo: true,
    status: 'available',
    published_at: now,
    created_at: now,
    updated_at: now,
  });

  const login = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@baliktela.demo', password: 'BalikTelaDemo2026!' }),
  });
  if (!login.ok) throw new Error(`Web API login failed with HTTP ${login.status}.`);
  const authentication = await login.json() as { token: string };
  const headers = { authorization: `Bearer ${authentication.token}` };

  const [batchResponse, listingResponse] = await Promise.all([
    fetch(`${apiUrl}/material-batches`, { headers }),
    fetch(`${apiUrl}/barter/listings`, { headers }),
  ]);
  if (!batchResponse.ok || !listingResponse.ok) throw new Error(`Web API read failed (${batchResponse.status}/${listingResponse.status}).`);

  const { batches } = await batchResponse.json() as { batches: { id: string; measurements: { id: string }[] }[] };
  const { listings } = await listingResponse.json() as { listings: { id: string }[] };
  const batch = batches.find((item) => item.id === batchId);
  const listing = listings.find((item) => item.id === listingId);
  if (!batch || !listing || !batch.measurements.some((item) => item.id === measurementId)) {
    throw new Error('The web API did not expose all mobile-style canonical records.');
  }

  console.log(JSON.stringify({ database: supabase ? 'supabase' : databaseName, result: 'passed', verified: { batchId, measurementId, listingId } }, null, 2));
} finally {
  await remove('listings', listingId);
  await remove('measurements', measurementId);
  await remove('material_batches', batchId);
  await client?.close();
}

async function insert(table: string, document: StringIdDocument) {
  if (supabase) {
    const { _id, ...values } = document;
    const { error } = await supabase.from(table).insert(normalize({ id: _id, ...values }));
    if (error) throw new Error(`Supabase insert into ${table} failed: ${error.message}`);
  } else {
    await db!.collection<StringIdDocument>(table).insertOne(document);
  }
}

async function remove(table: string, id: string) {
  if (supabase) {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw new Error(`Supabase cleanup of ${table} failed: ${error.message}`);
  } else {
    await db!.collection<StringIdDocument>(table).deleteOne({ _id: id });
  }
}

function normalize(value: unknown): any {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
}
