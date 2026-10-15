import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { planDemoRetirement } from '../server/accountRetirement.js';
import { SupabaseStore } from '../server/supabaseStore.js';
import { saveManagement } from '../server/management.js';

const apply = process.argv.includes('--apply');
if (apply && process.env.DEMO_ACCOUNTS_RETIRE !== 'true') throw new Error('Set DEMO_ACCOUNTS_RETIRE=true to intentionally disable the six published demo identities.');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const primaryEmail = process.env.PRIMARY_ADMIN_EMAIL;
if (!url || !key || !primaryEmail) throw new Error('SUPABASE_URL, SUPABASE_SECRET_KEY, and PRIMARY_ADMIN_EMAIL are required.');
const store = new SupabaseStore(url, key);
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { primary, targets } = planDemoRetirement(await store.all('users'), primaryEmail);
const primaryAuth = await client.auth.admin.getUserById(primary.authUserId!);
if (primaryAuth.error || !primaryAuth.data.user.email_confirmed_at || !primaryAuth.data.user.last_sign_in_at || (primaryAuth.data.user.banned_until && Date.parse(primaryAuth.data.user.banned_until) > Date.now())) throw new Error('The private primary administrator must have confirmed email, a successful sign-in, and an unbanned Supabase identity.');
if (!apply) {
  console.log(JSON.stringify({ mode: 'dry-run', primaryAdministrator: primary.email, accountsToDisable: targets.map(user => ({ id: user.id, email: user.email, status: user.accountStatus })), preserved: 'All non-demo identities and all linked research/transaction records.' }, null, 2));
} else {
  if (targets.length) await saveManagement(store, primary, targets.map(user => ({ name: 'users' as const, previous: user, record: { ...user, accountStatus: 'Deactivated' as const } })), 'auth.demo_accounts.retired', 'published-demo-identities', 'Published demo sign-in retired; private primary and backup administrators retained. No research records deleted.');
  for (const target of targets) {
    const at = new Date().toISOString();
    await store.revokeUserSessions(target.id, at);
    await store.invalidateAuthChallenges(target.id, 'password_reset', at);
    await store.invalidateAuthChallenges(target.id, 'email_verification', at);
    if (target.authUserId) {
      const { data, error } = await client.auth.admin.updateUserById(target.authUserId, { ban_duration: '876000h', password: `${randomBytes(48).toString('base64url')}aA1!` });
      if (error || !data.user?.banned_until) throw new Error(`Profile ${target.id} was deactivated, but native Auth retirement failed. Retry the command; do not re-enable the profile.`);
    }
  }
  console.log(JSON.stringify({ result: 'retired', disabledAccounts: targets.map(user => user.email), privateAdministratorPreserved: primary.email, applicationSessions: 'revoked', nativeIdentities: 'banned with discarded random passwords', data: 'No profiles, organizations, material batches, transactions, or history deleted.' }, null, 2));
}
