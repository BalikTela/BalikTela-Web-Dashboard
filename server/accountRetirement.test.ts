import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedData } from './seed.js';
import { planDemoRetirement } from './accountRetirement.js';

test('demo retirement preserves private administrators and all non-demo identities', async () => {
  const seed = await createSeedData();
  const primary = { ...seed.users.find(user => user.role === 'Administrator')!, id: 'PRIVATE-ADMIN', authUserId: 'private-auth-id', email: 'primary@example.test' };
  const backup = { ...primary, id: 'BACKUP-ADMIN', authUserId: 'backup-auth-id', email: 'backup@example.test' };
  const plan = planDemoRetirement([...seed.users, primary, backup], ' PRIMARY@example.test ');
  assert.equal(plan.primary.id, primary.id);
  assert.equal(plan.targets.length, 6);
  assert.ok(plan.targets.every(user => user.email.endsWith('@baliktela.demo')));
  assert.ok(!plan.targets.some(user => [primary.id, backup.id].includes(user.id)));
});

test('demo retirement refuses missing, unverified, disabled, uninitialized, and demo-only recovery access', async () => {
  const { users } = await createSeedData();
  const primary = { ...users.find(user => user.role === 'Administrator')!, id: 'PRIVATE-ADMIN', authUserId: 'private-auth-id', email: 'primary@example.test' };
  assert.throws(() => planDemoRetirement(users, 'admin@baliktela.demo'));
  assert.throws(() => planDemoRetirement(users, primary.email));
  for (const patch of [{ accountStatus: 'Deactivated' as const }, { emailVerifiedAt: null }, { passwordChangedAt: null }, { authUserId: null }, { role: 'Researcher' as const }]) {
    assert.throws(() => planDemoRetirement([...users, { ...primary, ...patch }], primary.email));
  }
});
