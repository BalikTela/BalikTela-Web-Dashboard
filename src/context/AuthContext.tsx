import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AccessSummary, PlatformUser } from '../platformTypes';
import { clearReauthenticationNotice, clearToken, getStoredToken, pendingReauthentication, platformApi, requireReauthentication, storeToken } from '../services/platformApi';
import { accountAccessSignature, reauthenticationCode, REAUTHENTICATION_MESSAGES, SESSION_CHECK_INTERVAL_MS } from '../../shared/sessionPolicy';

interface AuthContextValue {
  user: PlatformUser | null;
  access: AccessSummary | null;
  storageMode: string;
  isLoading: boolean;
  error: string;
  login(email: string, password: string): Promise<void>;
  register(body: Record<string, unknown>): Promise<{ message: string }>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
  changePassword(currentPassword: string, password: string): Promise<void>;
  updateUser(user: PlatformUser): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [access, setAccess] = useState<AccessSummary | null>(null);
  const [storageMode, setStorageMode] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(() => {
    const code = pendingReauthentication();
    return code ? REAUTHENTICATION_MESSAGES[code] : '';
  });
  const authRevision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const revision = authRevision.current;
    const expired = (event: Event) => {
      authRevision.current++;
      clearToken(); setUser(null); setAccess(null); setStorageMode(''); setIsLoading(false);
      const code = reauthenticationCode((event as CustomEvent).detail) ?? pendingReauthentication() ?? 'SESSION_EXPIRED';
      setError(REAUTHENTICATION_MESSAGES[code]);
    };
    window.addEventListener('baliktela:auth-expired', expired);
    if (pendingReauthentication()) {
      setIsLoading(false);
      return () => window.removeEventListener('baliktela:auth-expired', expired);
    }
    // A delayed bootstrap response must not replace a later login or restore a signed-out user.
    const stillCurrent = () => !cancelled && authRevision.current === revision;
    platformApi.me().then(({ user: current, access: currentAccess, storage }) => {
      if (stillCurrent()) { setUser(current); setAccess(currentAccess); setStorageMode(storage); }
    }).catch(() => {
      if (stillCurrent()) { clearToken(); setUser(null); setAccess(null); }
    }).finally(() => { if (stillCurrent()) setIsLoading(false); });
    return () => { cancelled = true; window.removeEventListener('baliktela:auth-expired', expired); };
  }, []);

  const signature = user && access ? accountAccessSignature(user, access.permissions) : '';
  useEffect(() => {
    if (!signature) return;
    let cancelled = false;
    let checking = false;
    let checkedAt = 0;
    let controller: AbortController | undefined;
    const revision = authRevision.current;
    const check = async () => {
      if (document.hidden || checking || Date.now() - checkedAt < 2_000) return;
      checking = true;
      checkedAt = Date.now();
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 8_000);
      try {
        const current = await platformApi.me(controller.signal);
        if (!cancelled && revision === authRevision.current && accountAccessSignature(current.user, current.access.permissions) !== signature) requireReauthentication('ACCOUNT_CHANGED');
      } catch { /* Only authoritative authentication errors end a session, not offline/timeouts. */ }
      finally { window.clearTimeout(timeout); checking = false; }
    };
    const refresh = () => { void check(); };
    const timer = window.setInterval(refresh, SESSION_CHECK_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true; controller?.abort(); window.clearInterval(timer);
      window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [signature]);

  const value = useMemo<AuthContextValue>(() => ({
    user, access, storageMode, isLoading, error,
    async login(email, password) {
      const revision = ++authRevision.current;
      setError('');
      try { const result = await platformApi.login(email, password); if (revision !== authRevision.current) return; clearReauthenticationNotice(); storeToken(result.accessToken, result.csrfToken); setUser(result.user); setAccess(result.access); setStorageMode(result.storage); setIsLoading(false); }
      catch (reason) { const message = reason instanceof Error ? reason.message : 'Unable to sign in.'; if (revision === authRevision.current) setError(message); throw reason; }
    },
    async register(body) {
      authRevision.current++;
      setError('');
      try {
        const result = await platformApi.register(body);
        if (result.accessToken && result.access && result.storage) { storeToken(result.accessToken, result.csrfToken); setUser(result.user); setAccess(result.access); setStorageMode(result.storage); }
        return { message: result.message ?? (result.requiresEmailVerification ? 'Check your email to confirm your account.' : 'Account created.') };
      }
      catch (reason) { const message = reason instanceof Error ? reason.message : 'Unable to create account.'; setError(message); throw reason; }
    },
    async logout() {
      authRevision.current++;
      setError(''); clearReauthenticationNotice();
      try { if (getStoredToken()) await platformApi.logout(); }
      catch { setError('Server sign-out could not be confirmed. Reconnect and sign out again before leaving a shared device.'); }
      finally { clearToken(); setUser(null); setAccess(null); setStorageMode(''); }
    },
    async logoutAll() {
      authRevision.current++;
      setError(''); clearReauthenticationNotice();
      try { if (getStoredToken()) await platformApi.logoutAll(); }
      catch { setError('Sign-out on other devices could not be confirmed. Reconnect and retry.'); }
      finally { clearToken(); setUser(null); setAccess(null); setStorageMode(''); }
    },
    async changePassword(currentPassword, password) {
      await platformApi.changePassword(currentPassword, password);
      authRevision.current++;
      clearToken(); setUser(null); setAccess(null); setStorageMode('');
    },
    updateUser(updated) { setUser(updated); },
  }), [access, error, isLoading, storageMode, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
