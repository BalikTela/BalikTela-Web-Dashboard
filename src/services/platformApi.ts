import type { AccessSummary, AuditRecord, AuthSessionSummary, BarterListing, BarterOffer, ChatMessage, Conversation, DashboardAnalytics, DataQualityResult, GovernanceData, MaterialBatch, OperationsAnalytics, Organization, PlatformConfiguration, PlatformFacility, PlatformUser, RecoveryRecord, ReportDefinition, Transfer, WalletEntry } from '../platformTypes';

const CSRF_KEY = 'baliktela_csrf';
let accessToken: string | null = null;
let refreshPromise: Promise<void> | null = null;

export function getStoredToken() { return accessToken; }
export function storeToken(token: string, csrfToken?: string) { accessToken = token; if (csrfToken) localStorage.setItem(CSRF_KEY, csrfToken); }
export function clearToken() { accessToken = null; localStorage.removeItem(CSRF_KEY); localStorage.removeItem('baliktela_session'); }

interface AuthenticationResult {
  token: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  csrfToken?: string;
  session: AuthSessionSummary;
  user: PlatformUser;
  access: AccessSummary;
  storage: string;
}

interface RegistrationResult {
  message?: string;
  requiresEmailVerification?: boolean;
  user: PlatformUser;
  accessToken?: string;
  token?: string;
  csrfToken?: string;
  access?: AccessSummary;
  storage?: string;
}

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const csrfToken = localStorage.getItem(CSRF_KEY);
      const response = await fetch('/api/auth/refresh', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
        body: '{}',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { clearToken(); throw new Error(payload.message ?? 'Your session has expired.'); }
      storeToken(payload.accessToken ?? payload.token, payload.csrfToken);
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
  const token = accessToken;
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (response.status === 401 && allowRefresh && !['/auth/login', '/auth/register', '/auth/refresh'].includes(path)) {
    if (!accessToken || accessToken === token) await refreshAccessToken();
    return request<T>(path, init, false);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? 'The BalikTela service could not complete this request.');
  if (init.method && init.method !== 'GET' && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('baliktela:records-changed', {detail:path}));
  return payload as T;
}

function queryString(filters?: Record<string, unknown>) {
  if (!filters) return '';
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') params.set(key, String(value)); });
  const result = params.toString(); return result ? `?${result}` : '';
}

export const platformApi = {
  login: (email: string, password: string) => request<AuthenticationResult>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, client: 'web' }) }),
  register: (body: Record<string, unknown>) => request<RegistrationResult>('/auth/register', { method: 'POST', body: JSON.stringify({ ...body, client: 'web' }) }),
  forgotPassword: (email: string) => request<{ message: string; demoResetToken?: string }>('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email, client: 'web' }) }),
  resolveEmailLink: (credentials: { accessToken?: string; refreshToken?: string; tokenHash?: string; type?: string }) => request<{ email: string; intent: 'invite' | 'recovery' | 'confirmation'; requiresPassword: boolean; accessToken?: string; refreshToken?: string }>('/auth/link/resolve', { method: 'POST', body: JSON.stringify(credentials) }, false),
  resetPassword: (credentials: { token?: string; accessToken?: string; refreshToken?: string }, password: string) => request<{ message: string; email?: string }>('/auth/password/reset', { method: 'POST', body: JSON.stringify({ ...credentials, password }) }, false),
  changePassword: (currentPassword: string, password: string) => request<{ message: string }>('/auth/password/change', { method: 'POST', body: JSON.stringify({ currentPassword, password }) }),
  verifyEmail: (token: string) => request<{ message: string }>('/auth/email/verify', { method: 'POST', body: JSON.stringify({ token }) }),
  resendEmailVerification: (email?: string) => email
    ? request<{ message: string }>('/auth/email/resend-request', { method: 'POST', body: JSON.stringify({ email, client: 'web' }) })
    : request<{ message: string; demoEmailVerificationToken?: string }>('/auth/email/resend', { method: 'POST', body: JSON.stringify({ client: 'web' }) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  logoutAll: () => request<{ revokedSessions: number }>('/auth/logout-all', { method: 'POST' }),
  sessions: () => request<{ sessions: AuthSessionSummary[] }>('/auth/sessions'),
  revokeSession: (sessionId: string) => request<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  me: () => request<{ user: PlatformUser; access: AccessSummary; storage: string }>('/auth/me'),
  updateProfile: (body: Partial<PlatformUser>) => request<{ user: PlatformUser }>('/users/me', { method: 'PATCH', body: JSON.stringify(body) }),
  users: () => request<{ users: PlatformUser[] }>('/users'),
  setVerification: (userId: string, verification: PlatformUser['verification']) => request<{ user: PlatformUser }>(`/users/${userId}/verification`, { method: 'PATCH', body: JSON.stringify({ verification }) }),
  createUser: (body: Record<string, unknown>) => request<{ user: PlatformUser; message: string; temporaryPassword?: string; demoEmailVerificationToken?: string; demoInvitationLink?: string }>('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUserAccess: (userId: string, body: Record<string, unknown>) => request<{ user: PlatformUser }>(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  organizations: () => request<{ organizations: Organization[] }>('/organizations'),
  createOrganization: (body: Record<string, unknown>) => request<{ organization: Organization }>('/organizations', { method: 'POST', body: JSON.stringify(body) }),
  updateOrganization: (id: string, body: Record<string, unknown>) => request<{ organization: Organization }>(`/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listings: (query = '') => request<{ listings: BarterListing[] }>(`/barter/listings${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  updateListing: (id: string, body: Record<string, unknown>) => request<{listing: BarterListing}>(`/barter/listings/${encodeURIComponent(id)}`, {method:'PATCH',body:JSON.stringify(body)}),
  createListing: (body: Record<string, unknown>) => request<{ listing: BarterListing }>('/barter/listings', { method: 'POST', body: JSON.stringify(body) }),
  matches: (listingId: string) => request<{ source: BarterListing; matches: Array<{ listing: BarterListing; score: number; reasons: string[] }>; method: string }>(`/barter/listings/${listingId}/matches`),
  offers: () => request<{ offers: BarterOffer[] }>('/barter/offers'),
  createOffer: (listingId: string, body: Record<string, unknown>) => request<{ offer: BarterOffer }>(`/barter/listings/${listingId}/offers`, { method: 'POST', body: JSON.stringify(body) }),
  decideOffer: (offerId: string, status: 'Accepted' | 'Declined') => request<{ offer: BarterOffer }>(`/barter/offers/${offerId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  manageOffer: (id: string, body: Record<string, unknown>) => request<{offer:BarterOffer}>(`/barter/offers/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)}),
  transfers: () => request<{ transfers: Transfer[] }>('/transfers'),
  advanceTransfer: (transferId: string, body: Record<string, unknown>) => request<{ transfer: Transfer }>(`/transfers/${transferId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  materialBatches: (filters?: Record<string, unknown>) => request<{ batches: MaterialBatch[] }>(`/material-batches${queryString(filters)}`),
  createMaterialBatch: (body: Record<string, unknown>) => request<{batch:MaterialBatch}>('/material-batches',{method:'POST',body:JSON.stringify(body)}),
  updateMaterialBatch: (id: string, body: Record<string, unknown>) => request<{batch:MaterialBatch}>(`/material-batches/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)}),
  facilities: (filters?: Record<string, unknown>) => request<{ facilities: PlatformFacility[] }>(`/facilities${queryString(filters)}`),
  createFacility: (body: Record<string, unknown>) => request<{ facility: PlatformFacility }>('/facilities', { method: 'POST', body: JSON.stringify(body) }),
  updateFacility: (id: string, body: Record<string, unknown>) => request<{ facility: PlatformFacility }>(`/facilities/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  recoveryRecords: (filters?: Record<string, unknown>) => request<{ records: RecoveryRecord[] }>(`/recovery-records${queryString(filters)}`),
  createRecoveryRecord: (body: Record<string, unknown>) => request<{ record: RecoveryRecord }>('/recovery-records', { method: 'POST', body: JSON.stringify(body) }),
  updateRecoveryRecord: (id: string, body: Record<string, unknown>) => request<{record:RecoveryRecord}>(`/recovery-records/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)}),
  operationsAnalytics: (filters?: Record<string, unknown>) => request<OperationsAnalytics>(`/analytics/operations${queryString(filters)}`),
  dashboardAnalytics: (filters?: Record<string, unknown>, signal?: AbortSignal) => request<DashboardAnalytics>(`/analytics/dashboard${queryString(filters)}`, { signal }),
  dataQuality: (filters?: Record<string, unknown>) => request<DataQualityResult>(`/data-quality${queryString(filters)}`),
  auditRecords: (filters?: Record<string, unknown>) => request<{ records: AuditRecord[] }>(`/audit-records${queryString(filters)}`),
  configuration: () => request<{ configuration: PlatformConfiguration }>('/configuration'),
  updateConfiguration: (body: Partial<PlatformConfiguration>) => request<{ configuration: PlatformConfiguration }>('/configuration', { method: 'PATCH', body: JSON.stringify(body) }),
  governance: () => request<GovernanceData>('/governance'),
  reports: () => request<{ reports: ReportDefinition[]; scope: { role: string; canExport: boolean; aggregateOnly: boolean } }>('/reports'),
  async exportReport(reportId: string) {
    const response = await fetch(`/api/reports/${encodeURIComponent(reportId)}/export`, { headers: { ...(getStoredToken() ? { Authorization: `Bearer ${getStoredToken()}` } : {}) } });
    if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.message ?? 'Unable to export this report.'); }
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `baliktela-${reportId}-demo.csv`; link.click(); URL.revokeObjectURL(url);
  },
  conversations: () => request<{ conversations: Conversation[] }>('/barter/conversations'),
  messages: (conversationId: string) => request<{ conversation: Conversation; messages: ChatMessage[] }>(`/barter/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, body: string) => request<{ message: ChatMessage }>(`/barter/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  wallet: () => request<{ balance: number; entries: WalletEntry[] }>('/wallet'),
};
