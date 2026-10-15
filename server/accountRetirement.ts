import type { UserRecord } from './types.js';

const demoEmails = new Set(['admin', 'government', 'researcher', 'producer', 'recycler', 'consumer'].map(name => `${name}@baliktela.demo`));

export function planDemoRetirement(users: UserRecord[], primaryEmail: string) {
  const email = primaryEmail.trim().toLowerCase();
  const primary = users.find(user => user.email.toLowerCase() === email);
  if (!primary || demoEmails.has(email) || primary.role !== 'Administrator' || primary.accountStatus !== 'Active'
    || primary.verification !== 'Demo verified' || !primary.emailVerifiedAt || !primary.passwordChangedAt || !primary.authUserId) {
    throw new Error('A verified, active, non-demo primary administrator with an initialized Supabase identity is required.');
  }
  return { primary, targets: users.filter(user => demoEmails.has(user.email.toLowerCase())) };
}
