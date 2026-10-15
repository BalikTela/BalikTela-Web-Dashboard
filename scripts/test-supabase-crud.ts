import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { SupabaseStore } from '../server/supabaseStore.js';
import { provisionedUserMutation } from '../server/provisioning.js';
import type { UserRecord, UserRole } from '../server/types.js';

if (process.env.SUPABASE_CRUD_TEST !== 'true') throw new Error('Set SUPABASE_CRUD_TEST=true to authorize temporary live CRUD fixtures.');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
if (!url || !key || !publicKey) throw new Error('Supabase credentials are required.');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const store = new SupabaseStore(url, key);
const api = (process.env.CRUD_TEST_API_URL ?? 'http://127.0.0.1:4000/api').replace(/\/$/, '');
const suffix = randomUUID().slice(0, 8);
const password = `Crud-${randomUUID()}!`;
const fixtureUsers: UserRecord[] = [];
const authIds: string[] = [];
const ids = new Map<string, Set<string>>();
const checks: string[] = [];
function remember(table: string, id: string) {
  if (!ids.has(table)) ids.set(table, new Set());
  ids.get(table)!.add(id);
}
async function call(path: string, method = 'GET', body?: Record<string, unknown>, token?: string, status = 200) {
  const response = await fetch(`${api}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000) });
  const value = await response.json() as Record<string, any>;
  assert.equal(response.status, status, `${method} ${path}: ${value.message ?? response.statusText}`);
  if (method !== 'GET') console.log(`${method} ${path.split('/').slice(0, 3).join('/')} -> ${status}`);
  for (const [field, table] of Object.entries({ organization: 'organizations', facility: 'facilities', batch: 'material_batches', measurement: 'measurements', listing: 'listings', offer: 'match_requests', transfer: 'transfers', record: 'recovery_records' })) {
    if (method !== 'GET' && value[field]?.id) remember(table, value[field].id);
  }
  return value;
}
async function login(user: UserRecord) { return (await call('/auth/login', 'POST', { email: user.email, password, client: 'api' })).accessToken as string; }
async function provision(role: UserRole) {
  const now = new Date().toISOString();
  const id = `USR-CRUD-${suffix}-${role}`;
  const email = `baliktela.crud.${suffix}.${role.toLowerCase()}@example.test`;
  const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { profile_id: id, full_name: `CRUD ${role} (demo)`, role } });
  if (error || !data.user) throw error ?? new Error('Unable to create temporary Auth identity.');
  authIds.push(data.user.id);
  const user: UserRecord = {
    id, authUserId: data.user.id, email, passwordHash: null, fullName: `CRUD ${role} (demo)`, role,
    organizationId: null, organization: 'Temporary CRUD demo', city: 'Manila', region: 'Metro Manila',
    joinedAt: now, consentAt: now, emailVerifiedAt: now, passwordChangedAt: now,
    verification: 'Demo verified', accountStatus: 'Active',
    scope: { organizationIds: [], facilityIds: [], regions: [], canExport: role === 'Administrator', aggregateOnly: false },
    trustPlaceholder: 50,
    profile: { ageGroup: '', organizationSize: 'Demo', productionVolumeKg: 0, recyclingPractices: '', acceptedTextiles: ['Cotton'], sustainabilityInterests: [] },
  };
  const mutation = await provisionedUserMutation(store, user);
  fixtureUsers.push(mutation.record);
  remember('users', mutation.record.id);
  await store.commit([mutation]);
  console.log(`Provisioned temporary ${role} demo profile.`);
  return mutation.record;
}
async function cleanup() {
  const userIds = fixtureUsers.map(user => user.id);
  if (userIds.length) {
    // Find only records owned/created by this run, including writes whose response was interrupted.
    for (const [table, column] of [['material_batches', 'source_user_id'], ['listings', 'owner_id'], ['match_requests', 'requester_id'], ['transfers', 'provider_id'], ['activity_logs', 'actor_id']] as const) {
      const { data, error } = await client.from(table).select('id').in(column, userIds);
      if (error) throw error;
      for (const row of data ?? []) remember(table, row.id);
    }
  }
  const batchIds = [...(ids.get('material_batches') ?? [])];
  const transferIds = [...(ids.get('transfers') ?? [])];
  const listingIds = [...(ids.get('listings') ?? [])];
  for (const [table, column, values] of [
    ['measurements', 'batch_id', batchIds], ['flow_events', 'transfer_id', transferIds],
    ['recovery_records', 'transfer_id', transferIds], ['reward_ledger', 'user_id', userIds],
    ['conversations', 'listing_id', listingIds],
  ] as const) {
    if (!values.length) continue;
    const { data, error } = await client.from(table).select('id').in(column, values);
    if (error) throw error;
    for (const row of data ?? []) remember(table, row.id);
  }
  for (const table of ['sessions', 'auth_challenges', 'auth_account_security']) {
    if (!userIds.length) continue;
    const { error } = await client.from(table).delete().in('user_id', userIds);
    if (error) throw error;
  }
  for (const table of ['activity_logs', 'messages', 'conversations', 'reward_ledger', 'recovery_records', 'flow_events', 'measurements', 'transfers', 'match_requests', 'listings', 'material_batches', 'facilities', 'users', 'organizations']) {
    const values = [...(ids.get(table) ?? [])];
    if (!values.length) continue;
    const { error } = await client.from(table).delete().in('id', values);
    if (error) throw error;
    const { count, error: checkError } = await client.from(table).select('id', { count: 'exact', head: true }).in('id', values);
    if (checkError) throw checkError;
    assert.equal(count, 0, `Temporary ${table} records were not removed.`);
  }
  for (const id of authIds) {
    const { error } = await client.auth.admin.deleteUser(id);
    if (error) throw error;
  }
}

try {
  assert.equal((await call('/health')).storage, 'supabase', 'Live checks require the Supabase API.');
  const administrator = await provision('Administrator');
  const recyclerUser = await provision('Recycler');
  const researcherUser = await provision('Researcher');
  const admin = await login(administrator);
  const recycler = await login(recyclerUser);
  const researcher = await login(researcherUser);

  const org = (await call('/organizations', 'POST', { name: `CRUD ${suffix} NGO (demo)`, type: 'NGO', city: 'Manila', region: 'Metro Manila', recordLabel: 'Demo', acceptedMaterials: ['Cotton'], serviceAreas: ['Manila'] }, admin, 201)).organization;
  await call(`/organizations/${org.id}`, 'PATCH', { name: `CRUD ${suffix} Edited NGO (demo)`, contactEmail: 'crud@example.test', reason: 'Temporary CRUD acceptance edit' }, admin);
  await call(`/organizations/${org.id}`, 'DELETE', { reason: 'Temporary CRUD deactivate' }, admin);
  assert.equal((await call('/organizations', 'GET', undefined, admin)).organizations.find((item: any) => item.id === org.id).status, 'Inactive');
  await call(`/organizations/${org.id}`, 'PATCH', { status: 'Prospective sample', reason: 'Temporary CRUD restore' }, admin);
  checks.push('Organization create/read/edit/deactivate/restore');

  const facility = (await call('/facilities', 'POST', { organizationId: org.id, name: `CRUD ${suffix} Facility (demo)`, city: 'Manila', region: 'Metro Manila', monthlyCapacityKg: 1000, isDemo: true }, admin, 201)).facility;
  await call(`/facilities/${facility.id}`, 'PATCH', { monthlyCapacityKg: 1200, acceptedMaterials: ['Cotton'], reason: 'Temporary CRUD edit' }, admin);
  await call(`/facilities/${facility.id}`, 'DELETE', { reason: 'Temporary CRUD deactivate' }, admin);
  assert.equal((await call('/facilities', 'GET', undefined, admin)).facilities.find((item: any) => item.id === facility.id).status, 'Inactive');
  await call(`/facilities/${facility.id}`, 'PATCH', { status: 'Available', reason: 'Temporary CRUD restore' }, admin);
  await call(`/facilities/${facility.id}`, 'PATCH', { monthlyCapacityKg: -1 }, admin, 400);
  checks.push('Facility CRUD and numeric validation');

  const batch = (await call('/material-batches', 'POST', { sourceUserId: administrator.id, materialCategory: 'Cotton', wasteSource: 'Pre-consumer', wasteForm: 'Offcuts', condition: 'Recyclable', circularPathway: 'Recycling', declaredWeightKg: 10, weightStatus: 'Measured', city: 'Manila', region: 'Metro Manila', method: 'Test scale', reason: 'Temporary CRUD registration', isDemo: true }, admin, 201)).batch;
  await call(`/material-batches/${batch.id}`, 'PATCH', { declaredWeightKg: 12, method: 'Reweigh', reason: 'Temporary CRUD correction' }, admin);
  await call(`/material-batches/${batch.id}`, 'DELETE', { reason: 'Temporary CRUD archive' }, admin);
  await call(`/material-batches/${batch.id}`, 'PATCH', { reason: 'Cannot edit archived' }, admin, 409);
  await call(`/material-batches/${batch.id}`, 'PATCH', { action: 'restore', reason: 'Temporary CRUD restore' }, admin);
  assert.equal((await call('/material-batches', 'GET', undefined, admin)).batches.find((item: any) => item.id === batch.id).measurements.length, 2);
  await call(`/material-batches/${batch.id}`, 'PATCH', { reason: 'Forbidden' }, researcher, 403);
  checks.push('Batch registration/correction/archive/restore, weight history and role denial');

  const listing = (await call('/barter/listings', 'POST', { title: `CRUD ${suffix} listing (demo)`, textileType: 'Cotton', quantityKg: 10, wasteSource: 'Pre-consumer', wasteForm: 'Offcuts', quality: 'Recyclable', circularPathway: 'Recycling', weightStatus: 'Measured', measurementMethod: 'Test scale', isDemo: true }, admin, 201)).listing;
  assert.equal(listing.isDemo, true);
  await call(`/barter/listings/${listing.id}`, 'PATCH', { title: `Corrected ${suffix} listing (demo)`, reason: 'Temporary moderation' }, admin);
  await call(`/barter/listings/${listing.id}`, 'DELETE', { reason: 'Temporary closure' }, admin);
  await call(`/barter/listings/${listing.id}`, 'PATCH', { status: 'Open', reason: 'Temporary reopen' }, admin);
  checks.push('Listing create/read/moderate/close/reopen with demo label');

  const offer = (await call(`/barter/listings/${listing.id}/offers`, 'POST', { quantityKg: 10, terms: 'Complete batch collection', offeredCredits: 20 }, recycler, 201)).offer;
  await call(`/barter/offers/${offer.id}`, 'PATCH', { action: 'edit', quantityKg: 10, terms: 'Revised batch collection', offeredCredits: 20, reason: 'Temporary offer correction' }, admin);
  const accepted = await call(`/barter/offers/${offer.id}`, 'PATCH', { status: 'Accepted', reason: 'Temporary approval' }, admin);
  await call(`/barter/offers/${offer.id}`, 'PATCH', { status: 'Accepted' }, admin, 403);
  let transfer = accepted.transfer ?? (await call('/transfers', 'GET', undefined, admin)).transfers.find((item: any) => item.offerId === offer.id);
  assert.ok(transfer);
  remember('transfers', transfer.id);
  await call(`/transfers/${transfer.id}`, 'PATCH', { action: 'complete', circularOutcome: 'Recycling' }, admin, 400);
  await call(`/transfers/${transfer.id}`, 'PATCH', { action: 'handover', weightKg: 10, method: 'Test scale', note: 'Measured handover' }, admin);
  await call(`/transfers/${transfer.id}`, 'PATCH', { action: 'receipt', weightKg: 9, method: 'Test scale' }, admin, 400);
  await call(`/transfers/${transfer.id}`, 'PATCH', { action: 'receipt', weightKg: 9, method: 'Test scale', discrepancyReason: 'Packaging excluded' }, admin);
  await call(`/transfers/${transfer.id}`, 'PATCH', { action: 'validate', weightKg: 11, method: 'Test scale' }, admin, 400);
  await call(`/transfers/${transfer.id}`, 'PATCH', { action: 'validate', weightKg: 9, method: 'Test scale' }, admin);
  await call(`/transfers/${transfer.id}`, 'PATCH', { action: 'complete', circularOutcome: 'Recycling', note: 'Validated outcome' }, admin);
  await call(`/transfers/${transfer.id}`, 'DELETE', { note: 'Cannot cancel final' }, admin, 409);
  transfer = (await call('/transfers', 'GET', undefined, admin)).transfers.find((item: any) => item.id === transfer.id);
  assert.equal(transfer.events.length, 5);
  assert.equal(new Set(transfer.events.map((event: any) => event.id)).size, 5);
  checks.push('Offer edit/accept and ordered transfer lifecycle with terminal-state protection');

  const recovery = (await call('/recovery-records', 'POST', { transferId: transfer.id, facilityId: facility.id, stage: 'Sorting', inputWeightKg: 9, outputWeightKg: 8, residualWeightKg: 1, outcome: 'Recycling', note: 'Temporary recovery test' }, admin, 201)).record;
  await call(`/recovery-records/${recovery.id}`, 'PATCH', { action: 'edit', outputWeightKg: 7, residualWeightKg: 2, reason: 'Temporary recovery edit' }, admin);
  await call(`/recovery-records/${recovery.id}`, 'PATCH', { action: 'validate', reason: 'Measured and checked' }, admin);
  await call(`/recovery-records/${recovery.id}`, 'PATCH', { action: 'edit', reason: 'Cannot erase history' }, admin, 409);
  const replacement = (await call(`/recovery-records/${recovery.id}`, 'PATCH', { action: 'correct', inputWeightKg: 9, outputWeightKg: 8, residualWeightKg: 1, outcome: 'Recycling', reason: 'Replacement reading' }, admin)).record;
  await call(`/recovery-records/${replacement.id}`, 'DELETE', { reason: 'Temporary reversal' }, admin);
  const records = (await call('/recovery-records', 'GET', undefined, admin)).records;
  assert.equal(records.find((item: any) => item.id === recovery.id).status, 'Reversed');
  assert.equal(records.find((item: any) => item.id === replacement.id).status, 'Reversed');
  checks.push('Recovery create/edit/validate/correct/reverse preserves original');

  const { error: mobileError } = await client.from('users').update({ bio: 'Mobile-only field preservation check' }).eq('id', recyclerUser.id);
  if (mobileError) throw mobileError;
  await call('/users/me', 'PATCH', { fullName: `CRUD ${suffix} Updated profile (demo)` }, recycler);
  await call(`/users/${recyclerUser.id}`, 'PATCH', { fullName: `CRUD ${suffix} Approved profile (demo)`, organizationId: org.id, reason: 'Temporary account edit' }, admin);
  await call(`/users/${recyclerUser.id}`, 'DELETE', { reason: 'Temporary account deactivate' }, admin);
  const { data: deactivated } = await client.from('users').select('active').eq('id', recyclerUser.id).single();
  assert.equal(deactivated?.active, false);
  await call('/auth/me', 'GET', undefined, recycler, 401);
  await call(`/users/${recyclerUser.id}`, 'PATCH', { accountStatus: 'Active', approve: true, reason: 'Temporary account restore' }, admin);
  await login(recyclerUser);
  const { data: profile } = await client.from('users').select('bio').eq('id', recyclerUser.id).single();
  assert.equal(profile?.bio, 'Mobile-only field preservation check');
  checks.push('Auth-linked user CRUD, session revocation, restoration and mobile field preservation');

  const configuration = (await call('/configuration', 'GET', undefined, admin)).configuration;
  await call('/configuration', 'PATCH', { rewardCreditsPerVerifiedKg: configuration.rewardCreditsPerVerifiedKg, reason: 'Temporary CRUD no-op configuration acceptance' }, admin);
  await call('/configuration', 'PATCH', { discrepancyThresholdPercent: -1 }, admin, 400);
  checks.push('Configuration persistence and invalid-rule rejection without changing shared rules');

  const previous = await store.findById('organizations', org.id);
  assert.ok(previous);
  await assert.rejects(store.commit([
    { name: 'organizations', previous, record: { ...previous, name: `Rollback ${suffix} (demo)` } },
    { name: 'facilities', record: { ...facility, id: `FAC-INVALID-${suffix}`, monthlyCapacityKg: -1 } },
  ]));
  assert.equal((await store.findById('organizations', org.id))?.name, previous.name);
  await store.commit([{ name: 'organizations', previous, record: { ...previous, name: `CAS ${suffix} (demo)` } }]);
  await assert.rejects(store.commit([{ name: 'organizations', previous, record: { ...previous, name: `Stale ${suffix} (demo)` } }]), /changed/i);
  const anon = createClient(url, publicKey, { auth: { persistSession: false } });
  const { error: denied } = await anon.rpc('apply_management_mutations', { p_mutations: [] });
  assert.ok(denied, 'Anonymous clients must not execute management transactions.');
  checks.push('Atomic rollback, stale-update rejection and anonymous RPC denial');

  const audits = (await call('/audit-records', 'GET', undefined, admin)).records;
  assert.ok(audits.some((item: any) => item.entityId === recovery.id && item.action === 'recovery.correct'));
  assert.ok(audits.filter((item: any) => item.actorId === administrator.id).every((item: any) => !item.details.includes('passwordHash')));
  checks.push('Audited operations without password hashes');
} finally {
  await cleanup();
}
console.log(JSON.stringify({ result: 'passed', storage: 'supabase', checks, temporaryRecords: 'removed' }, null, 2));
