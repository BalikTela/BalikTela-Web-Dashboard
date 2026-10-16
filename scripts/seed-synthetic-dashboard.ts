import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';
import { encodeRecord } from '../server/database/codecs.js';
import { buildOperationalDemo, normalizeDemoRow as normalize } from '../server/analytics/operationalDemo.js';

if (process.env.SUPABASE_SYNTHETIC_SEED !== 'true') {
  console.error('Refusing to seed. Set SUPABASE_SYNTHETIC_SEED=true for an intentional synthetic-data operation.');
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const passwordHash = await bcrypt.hash(`Synthetic-${crypto.randomUUID()}`, 10);
const { domainTables, flowEvents } = buildOperationalDemo(undefined, undefined, passwordHash);

const tableNames: Record<string, string> = { organizations: 'organizations', users: 'users', facilities: 'facilities', materialBatches: 'material_batches', measurements: 'measurements', listings: 'listings', offers: 'match_requests', transfers: 'transfers', recoveryRecords: 'recovery_records', walletEntries: 'reward_ledger', systemInteractions: 'system_interactions' };
const seeded: Record<string, number> = {};
for (const [name, records] of domainTables) {
  const rows = records.map((record) => normalize(encodeRecord(name as never, record as never)));
  await upsertRows(tableNames[name], rows);
  seeded[tableNames[name]] = rows.length;
}
await upsertRows('flow_events', flowEvents);
seeded.flow_events = flowEvents.length;

console.log(JSON.stringify({ provider: 'supabase', dataset: 'synthetic-dashboard-v1', disclosure: 'All SYN- records are synthetic demo data.', seeded }, null, 2));

async function upsertRows(table: string, rows: Array<Record<string, unknown>>) {
  for (let index = 0; index < rows.length; index += 250) {
    const { error } = await supabase.from(table).upsert(rows.slice(index, index + 250), { onConflict: 'id' });
    if (error) throw new Error(`Could not seed ${table}: ${error.message}`);
  }
}
