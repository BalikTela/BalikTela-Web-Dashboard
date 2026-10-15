import type { Store } from './store.js';
import type { UserRecord } from './types.js';

export async function provisionedUserMutation(store: Store, draft: UserRecord) {
  const previous = draft.authUserId
    ? await store.findOne('users', user => user.authUserId === draft.authUserId)
    : null;
  // Mobile's Auth trigger can create the canonical profile before the web request saves it.
  const record = previous ? { ...draft, id: previous.id, joinedAt: previous.joinedAt } : draft;
  return { name: 'users' as const, record, ...(previous ? { previous } : {}) };
}
