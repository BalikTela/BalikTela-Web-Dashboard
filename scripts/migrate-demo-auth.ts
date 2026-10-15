import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { SupabaseIdentity } from '../server/supabaseIdentity.js';

if (process.env.SUPABASE_AUTH_MIGRATE !== 'true') {
  console.error('Refusing to migrate identities. Set SUPABASE_AUTH_MIGRATE=true for an intentional operation.');
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');

const database = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const identity = new SupabaseIdentity();
const password = process.env.DEMO_ACCOUNT_PASSWORD ?? 'BalikTelaDemo2026!';
const demoEmails = [
  'admin@baliktela.demo', 'government@baliktela.demo', 'researcher@baliktela.demo',
  'producer@baliktela.demo', 'recycler@baliktela.demo', 'consumer@baliktela.demo',
];

const { data: profiles, error } = await database.from('users').select('id,email,name,role').in('email', demoEmails);
if (error) throw error;
const linked: Array<{ profileId: string; authUserId: string; email: string }> = [];

for (const profile of profiles ?? []) {
  const auth = await identity.ensureDemoUser(String(profile.email), password, String(profile.id), String(profile.role), String(profile.name));
  const now = new Date().toISOString();
  const { error: profileError } = await database.from('users').update({ auth_user_id: auth.authUserId, passwordHash: null, updated_at: now }).eq('id', profile.id);
  if (profileError) throw profileError;
  const { error: securityError } = await database.from('auth_account_security').upsert({ id: `AAS-${profile.id}`, user_id: profile.id, email_verified_at: auth.emailConfirmedAt ?? now, password_changed_at: now, updated_at: now }, { onConflict: 'user_id' });
  if (securityError) throw securityError;
  linked.push({ profileId: String(profile.id), authUserId: auth.authUserId, email: String(profile.email) });
}

console.log(JSON.stringify({ provider: 'supabase-auth', linked: linked.length, accounts: linked }, null, 2));
