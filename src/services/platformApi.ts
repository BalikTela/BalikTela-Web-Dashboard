import type { AccessSummary, AuditRecord, AuthSessionSummary, BarterListing, BarterOffer, ChatMessage, Conversation, DashboardAnalytics, DataQualityResult, GovernanceData, MaterialBatch, OperationsAnalytics, Organization, PlatformConfiguration, PlatformFacility, PlatformUser, RecoveryRecord, ReportDefinition, Transfer, WalletEntry } from '../platformTypes';

import type { PredictiveReport } from '../../shared/predictive';
import type { ReportDocument } from '../../shared/reporting';
import { reauthenticationCode, REAUTHENTICATION_MESSAGES, type ReauthenticationCode } from '../../shared/sessionPolicy';

const CSRF_KEY = 'baliktela_csrf';
let accessToken: string | null = null;
let refreshPromise: Promise<void> | null = null;
let authenticationEpoch = 0;
const REAUTH_KEY = 'baliktela_reauthentication';

export function pendingReauthentication() { return reauthenticationCode(sessionStorage.getItem(REAUTH_KEY)); }
export function clearReauthenticationNotice() { sessionStorage.removeItem(REAUTH_KEY); }
export function requireReauthentication(code: ReauthenticationCode) {
  const token = accessToken;
  const hadSession = Boolean(token || localStorage.getItem(CSRF_KEY));
  if (!hadSession) return;
  sessionStorage.setItem(REAUTH_KEY, code);
  clearToken();
  window.dispatchEvent(new CustomEvent('baliktela:auth-expired', { detail: code }));
  if (token) {
    // Revoke only the old bearer session. Ignore cookies so a late response cannot clear a new login.
    void fetch('/api/auth/logout', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' }).catch(() => {});
  }
}

export function getStoredToken() { return accessToken; }
export function storeToken(token: string, csrfToken?: string) { accessToken = token; if (csrfToken) localStorage.setItem(CSRF_KEY, csrfToken); }
export function clearToken() { authenticationEpoch++; accessToken = null; localStorage.removeItem(CSRF_KEY); localStorage.removeItem('baliktela_session'); window.dispatchEvent(new Event('baliktela:auth-cleared')); }

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
      const epoch = authenticationEpoch;
      const csrfToken = localStorage.getItem(CSRF_KEY);
      const response = await fetch('/api/auth/refresh', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
        body: '{}',
      });
      const payload = await response.json().catch(() => ({}));
      if (epoch !== authenticationEpoch) throw new Error('The authentication state changed during this request.');
      if (!response.ok) {
        if ([401, 403].includes(response.status)) requireReauthentication(reauthenticationCode(payload.code) ?? 'SESSION_EXPIRED');
        throw new Error(payload.message ?? 'Your session has expired.');
      }
      storeToken(payload.accessToken ?? payload.token, payload.csrfToken);
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function request<T>(path: string, init: RequestInit = {}, allowRefresh = true, responseType: 'json' | 'text' = 'json'): Promise<T> {
  const token = accessToken;
  const epoch = authenticationEpoch;
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (epoch !== authenticationEpoch) throw new Error('The authentication state changed during this request.');
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (epoch !== authenticationEpoch) throw new Error('The authentication state changed during this request.');
    const code = reauthenticationCode(payload.code);
    if ([401, 403].includes(response.status) && code) {
      requireReauthentication(code);
      throw new Error(REAUTHENTICATION_MESSAGES[code]);
    }
    if (response.status === 401 && !['/auth/login', '/auth/register', '/auth/refresh'].includes(path)) {
      if (allowRefresh) {
        if (!accessToken || accessToken === token) await refreshAccessToken();
        return request<T>(path, init, false, responseType);
      }
      requireReauthentication('SESSION_EXPIRED');
    }
    throw new Error(payload.message ?? 'The BalikTela service could not complete this request.');
  }
  const payload = responseType === 'text' ? await response.text() : await response.json().catch(() => ({}));
  if (epoch !== authenticationEpoch) throw new Error('The authentication state changed during this request.');
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
  resolveEmailLink: (credentials: { accessToken?: string; refreshToken?: string; tokenHash?: string; type?: string }) => request<{ email: string; intent: 'invite' | 'recovery' | 'confirmation'; requiresPassword: boolean; setupToken?: string }>('/auth/link/resolve', { method: 'POST', body: JSON.stringify(credentials) }, false),
  requestSetupCode: (email: string) => request<{ message: string }>('/auth/setup/request', { method: 'POST', body: JSON.stringify({ email }) }, false),
  verifySetupCode: (email: string, code: string, purpose: 'invite' | 'recovery') => request<{ email: string; setupToken: string; intent: 'invite' | 'recovery'; expiresInSeconds: number }>('/auth/setup/verify', { method: 'POST', body: JSON.stringify({ email, code, purpose }) }, false),
  resetPassword: (credentials: { token?: string; setupToken?: string; accessToken?: string; refreshToken?: string }, password: string) => request<{ message: string; email?: string }>('/auth/password/reset', { method: 'POST', body: JSON.stringify({ ...credentials, password }) }, false),
  changePassword: (currentPassword: string, password: string) => request<{ message: string }>('/auth/password/change', { method: 'POST', body: JSON.stringify({ currentPassword, password }) }),
  verifyEmail: (token: string) => request<{ message: string }>('/auth/email/verify', { method: 'POST', body: JSON.stringify({ token }) }),
  resendEmailVerification: (email?: string) => email
    ? request<{ message: string }>('/auth/email/resend-request', { method: 'POST', body: JSON.stringify({ email, client: 'web' }) })
    : request<{ message: string; demoEmailVerificationToken?: string }>('/auth/email/resend', { method: 'POST', body: JSON.stringify({ client: 'web' }) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  logoutAll: () => request<{ revokedSessions: number }>('/auth/logout-all', { method: 'POST' }),
  sessions: () => request<{ sessions: AuthSessionSummary[] }>('/auth/sessions'),
  revokeSession: (sessionId: string) => request<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  me: (signal?: AbortSignal) => request<{ user: PlatformUser; access: AccessSummary; storage: string }>('/auth/me', { signal }),
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
  transfers: (filters?: Record<string, unknown>) => request<{ transfers: Transfer[] }>(`/transfers${queryString(filters)}`),
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
  predictiveAnalytics: (filters?: Record<string, unknown>, signal?: AbortSignal) => request<PredictiveReport>(`/analytics/predictive${queryString(filters)}`, { signal }),
  async exportPredictiveDataset(filters?: Record<string, unknown>) {
    const { csv, filename } = await request<{ csv: string; filename: string }>(`/analytics/predictive/dataset${queryString(filters)}`);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  },
  dataQuality: (filters?: Record<string, unknown>) => request<DataQualityResult>(`/data-quality${queryString(filters)}`),
  auditRecords: (filters?: Record<string, unknown>) => request<{ records: AuditRecord[] }>(`/audit-records${queryString(filters)}`),
  configuration: () => request<{ configuration: PlatformConfiguration }>('/configuration'),
  updateConfiguration: (body: Partial<PlatformConfiguration>) => request<{ configuration: PlatformConfiguration }>('/configuration', { method: 'PATCH', body: JSON.stringify(body) }),
  governance: () => request<GovernanceData>('/governance'),
  reports: () => request<{ reports: ReportDefinition[]; scope: { role: string; canExport: boolean; aggregateOnly: boolean } }>('/reports'),
  reportPreview: (reportId: string, filters?: Record<string, unknown>, signal?: AbortSignal) => request<ReportDocument>(`/reports/${encodeURIComponent(reportId)}/preview${queryString(filters)}`, { signal }),
  printableReport: (reportId: string, filters?: Record<string, unknown>) => request<ReportDocument>(`/reports/${encodeURIComponent(reportId)}/export${queryString({ ...filters, format: 'print' })}`),
  async exportReport(reportId: string, filters?: Record<string, unknown>, filename = `baliktela-${reportId}.csv`) {
    const csv = await request<string>(`/reports/${encodeURIComponent(reportId)}/export${queryString(filters)}`, {}, true, 'text');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  },
  conversations: () => request<{ conversations: Conversation[] }>('/barter/conversations'),
  messages: (conversationId: string) => request<{ conversation: Conversation; messages: ChatMessage[] }>(`/barter/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, body: string) => request<{ message: ChatMessage }>(`/barter/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  wallet: () => request<{ balance: number; entries: WalletEntry[] }>('/wallet'),
};
