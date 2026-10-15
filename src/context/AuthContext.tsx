import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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

  useEffect(() => {
    platformApi.me().then(({ user: current, access: currentAccess, storage }) => { setUser(current); setAccess(currentAccess); setStorageMode(storage); }).catch(() => { clearToken(); setAccess(null); }).finally(() => setIsLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user, access, storageMode, isLoading, error,
    async login(email, password) {
      setError('');
      try { const result = await platformApi.login(email, password); storeToken(result.accessToken, result.csrfToken); setUser(result.user); setAccess(result.access); setStorageMode(result.storage); }
      catch (reason) { const message = reason instanceof Error ? reason.message : 'Unable to sign in.'; setError(message); throw reason; }
    },
    async register(body) {
      setError('');
      try {
        const result = await platformApi.register(body);
        if (result.accessToken && result.access && result.storage) { storeToken(result.accessToken, result.csrfToken); setUser(result.user); setAccess(result.access); setStorageMode(result.storage); }
        return { message: result.message ?? (result.requiresEmailVerification ? 'Check your email to confirm your account.' : 'Account created.') };
      }
      catch (reason) { const message = reason instanceof Error ? reason.message : 'Unable to create account.'; setError(message); throw reason; }
    },
    async logout() {
      try { if (getStoredToken()) await platformApi.logout(); }
      catch { /* Local sign-out must still complete when the API is unavailable. */ }
      finally { clearToken(); setUser(null); setAccess(null); setStorageMode(''); }
    },
    async logoutAll() {
      try { if (getStoredToken()) await platformApi.logoutAll(); }
      catch { /* Local sign-out still completes if the API becomes unavailable. */ }
      finally { clearToken(); setUser(null); setAccess(null); setStorageMode(''); }
    },
    async changePassword(currentPassword, password) {
      await platformApi.changePassword(currentPassword, password);
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
