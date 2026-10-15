import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AccessSummary, PlatformUser } from '../platformTypes';
import { clearToken, getStoredToken, platformApi, storeToken } from '../services/platformApi';

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
  const [error, setError] = useState('');
  const authRevision = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const revision = authRevision.current;
    const expired = () => {
      authRevision.current++;
      clearToken(); setUser(null); setAccess(null); setStorageMode(''); setIsLoading(false);
      setError('Your session expired or was revoked. Sign in again.');
    };
    window.addEventListener('baliktela:auth-expired', expired);
    // A delayed bootstrap response must not replace a later login or restore a signed-out user.
    const stillCurrent = () => !cancelled && authRevision.current === revision;
    platformApi.me().then(({ user: current, access: currentAccess, storage }) => {
      if (stillCurrent()) { setUser(current); setAccess(currentAccess); setStorageMode(storage); }
    }).catch(() => {
      if (stillCurrent()) { clearToken(); setUser(null); setAccess(null); }
    }).finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; window.removeEventListener('baliktela:auth-expired', expired); };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user, access, storageMode, isLoading, error,
    async login(email, password) {
      authRevision.current++;
      setError('');
      try { const result = await platformApi.login(email, password); storeToken(result.accessToken, result.csrfToken); setUser(result.user); setAccess(result.access); setStorageMode(result.storage); }
      catch (reason) { const message = reason instanceof Error ? reason.message : 'Unable to sign in.'; setError(message); throw reason; }
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
      try { if (getStoredToken()) await platformApi.logout(); }
      catch { setError('Server sign-out could not be confirmed. Reconnect and sign out again before leaving a shared device.'); }
      finally { clearToken(); setUser(null); setAccess(null); setStorageMode(''); }
    },
    async logoutAll() {
      authRevision.current++;
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
