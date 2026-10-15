import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { passwordPolicyError } from '../server/auth.js';
import { planDemoRetirement } from '../server/accountRetirement.js';
import { SupabaseStore } from '../server/supabaseStore.js';
import { provisionedUserMutation } from '../server/provisioning.js';
import { saveManagement } from '../server/management.js';
import type { UserRecord } from '../server/types.js';

if (process.env.BACKUP_ADMIN_PROVISION !== 'true') throw new Error('Set BACKUP_ADMIN_PROVISION=true for this intentional, server-only account provisioning operation.');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const primaryEmail = process.env.PRIMARY_ADMIN_EMAIL;
const email = (process.env.BACKUP_ADMIN_EMAIL ?? 'backup-admin@baliktela.internal').trim().toLowerCase();
const password = process.env.BACKUP_ADMIN_PASSWORD ?? '';
if (!url || !key || !primaryEmail) throw new Error('Supabase server credentials and PRIMARY_ADMIN_EMAIL are required.');
const policy = passwordPolicyError(password);
if (policy || password.length < 20) throw new Error('Set a unique BACKUP_ADMIN_PASSWORD in the ignored local environment: at least 20 characters, uppercase, lowercase, a number, and a symbol. Never post it in chat.');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('@baliktela.demo') || email === primaryEmail.trim().toLowerCase()) throw new Error('The backup must have its own valid non-demo login identifier.');
const store = new SupabaseStore(url, key);
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { primary } = planDemoRetirement(await store.all('users'), primaryEmail);
const primaryAuth = await client.auth.admin.getUserById(primary.authUserId!);
if (primaryAuth.error || !primaryAuth.data.user.email_confirmed_at || !primaryAuth.data.user.last_sign_in_at || (primaryAuth.data.user.banned_until && Date.parse(primaryAuth.data.user.banned_until) > Date.now())) throw new Error('The primary administrator must have confirmed email, a successful sign-in, and an unbanned Supabase identity.');
const existing = await store.findOne('users', user => user.email === email);
const rotate = process.argv.includes('--rotate');
const at = new Date().toISOString();
if (existing) {
  if (!rotate || existing.role !== 'Administrator' || !existing.authUserId) throw new Error('This login already exists. No existing account was changed. Use --rotate only for a backup created by this command.');
  const current = await client.auth.admin.getUserById(existing.authUserId);
  if (current.error || current.data.user.user_metadata?.account_purpose !== 'emergency_admin') throw new Error('This is not an identified backup administrator. No account was changed.');
  const updated = await client.auth.admin.updateUserById(existing.authUserId, { password, ban_duration: 'none' });
  if (updated.error) throw new Error('Supabase could not rotate the backup password. Check Auth logs; no password is printed.');
  await store.revokeUserSessions(existing.id, at);
  await store.invalidateAuthChallenges(existing.id, 'password_reset', at);
  await store.invalidateAuthChallenges(existing.id, 'email_verification', at);
  const latest = await store.findById('users', existing.id);
  if (!latest) throw new Error('The backup profile no longer exists.');
  await saveManagement(store, primary, [{ name: 'users', previous: latest, record: { ...latest, accountStatus: 'Active', verification: 'Demo verified', passwordChangedAt: at } }], 'auth.backup_admin.rotated', latest.id, 'Backup credentials privately rotated by a server-side owner operation. Existing web sessions revoked.');
} else {
  if (rotate) throw new Error('The backup does not exist. Remove --rotate for initial provisioning.');
  const generated = await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: 'BalikTela Backup Administrator', account_purpose: 'emergency_admin' } });
  if (generated.error || !generated.data.user) throw new Error('Supabase could not create the backup identity. Check Auth logs; no password is printed.');
  const authUserId = generated.data.user.id;
  const user: UserRecord = { ...primary, id: `USR-BACKUP-${randomUUID()}`, authUserId, email, fullName: 'BalikTela Backup Administrator', passwordHash: null, joinedAt: at, consentAt: at, emailVerifiedAt: generated.data.user.email_confirmed_at ?? at, passwordChangedAt: at, accountStatus: 'Active', verification: 'Demo verified', scope: { organizationIds: [], facilityIds: [], regions: [], canExport: true, aggregateOnly: false }, profile: { ageGroup: '', organizationSize: '', productionVolumeKg: 0, recyclingPractices: '', acceptedTextiles: [], sustainabilityInterests: [] }, trustPlaceholder: 50 };
  try {
    const mutation = await provisionedUserMutation(store, user);
    await saveManagement(store, primary, [mutation], 'auth.backup_admin.provisioned', mutation.record.id, 'Named emergency administrator provisioned by a server-side owner operation using a privately supplied password; no email or authentication bypass.');
  } catch (error) {
    await client.auth.admin.deleteUser(authUserId);
    throw error;
  }
}
console.log(JSON.stringify({ result: rotate ? 'rotated' : 'created', email, role: 'Administrator', permissions: 'Same application permissions as the primary administrator.', authentication: 'Normal Supabase password login; no bypass.', password: 'Never printed. Remove BACKUP_ADMIN_PASSWORD from local/runtime environment after secure storage.' }, null, 2));
