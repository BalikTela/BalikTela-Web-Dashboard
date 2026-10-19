export const SESSION_CHECK_INTERVAL_MS = 15_000;

export const REAUTHENTICATION_MESSAGES = {
  ACCOUNT_CHANGED: 'Your role, permissions, or account settings have changed. You have been signed out. Sign in again to load your current access.',
  ACCOUNT_UNAVAILABLE: 'Your account is no longer available or has been suspended. You have been signed out. Contact a BalikTela administrator before signing in again.',
  SESSION_REVOKED: 'Your session was ended because of an account or security change, or a sign-out request. Sign in again to load your current access.',
  SESSION_EXPIRED: 'Your session has expired. Sign in again to continue.',
} as const;
export type ReauthenticationCode = keyof typeof REAUTHENTICATION_MESSAGES;
export function reauthenticationCode(value: unknown): ReauthenticationCode | undefined {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REAUTHENTICATION_MESSAGES, value) ? value as ReauthenticationCode : undefined;
}

interface AccountAccess {
  id: string; email: string; role: string; organizationId: string | null; verification: string; accountStatus: string;
  emailVerifiedAt: string | null; passwordChangedAt: string | null;
  organizationVerified?: boolean;
  scope: { organizationIds: string[]; facilityIds: string[]; regions: string[]; aggregateOnly: boolean; canExport: boolean };
}
export function accountAccessSignature(user: AccountAccess, permissions: readonly string[]) {
  const sorted = (values: readonly string[]) => [...new Set(values)].sort();
  const timestamp = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : value;
  return JSON.stringify([user.id, user.email, user.role, user.organizationId, user.verification, user.accountStatus,
    timestamp(user.emailVerifiedAt), timestamp(user.passwordChangedAt), user.organizationVerified, sorted(user.scope.organizationIds), sorted(user.scope.facilityIds),
    sorted(user.scope.regions), user.scope.aggregateOnly, user.scope.canExport, sorted(permissions)]);
}
