import { KeyRound, Laptop, LockKeyhole, LogOut, MailCheck, Server, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AuthSessionSummary } from '../platformTypes';
import { useAuth } from '../context/AuthContext';
import { platformApi } from '../services/platformApi';
import { Button } from './ui/button';
import { Input } from './ui/input';

export function SessionManagement() {
  const { user, logoutAll, changePassword, updateUser } = useAuth();
  const [sessions, setSessions] = useState<AuthSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    platformApi.sessions().then(({ sessions: records }) => setSessions(records)).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load sessions.')).finally(() => setLoading(false));
  }, []);

  const revoke = async (session: AuthSessionSummary) => {
    setError('');
    try {
      await platformApi.revokeSession(session.id);
      setSessions((records) => records.filter((record) => record.id !== session.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to revoke session.');
    }
  };

  const requestVerification = async () => {
    setError(''); setMessage('');
    try { const result = await platformApi.resendEmailVerification(user?.email); setMessage(result.message); const token = 'demoEmailVerificationToken' in result && typeof result.demoEmailVerificationToken === 'string' ? result.demoEmailVerificationToken : ''; setVerificationToken(token); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to request verification.'); }
  };

  const completeDemoVerification = async () => {
    setError('');
    try { const result = await platformApi.verifyEmail(verificationToken); const current = await platformApi.me(); updateUser(current.user); setVerificationToken(''); setMessage(result.message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to verify email.'); }
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    if (passwords.next !== passwords.confirm) { setError('New password confirmation does not match.'); return; }
    setChangingPassword(true);
    try { await changePassword(passwords.current, passwords.next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to change password.'); setChangingPassword(false); }
  };

  return (
    <section className="surface-panel rounded-md p-5">
      <div className="flex items-start gap-3"><KeyRound size={17} className="mt-0.5 text-emerald-700" /><div><h3 className="text-sm font-semibold text-[#17201d]">Active sessions</h3><p className="mt-1 text-xs leading-5 text-[#718079]">Refresh credentials are rotated and stored only as hashes.</p></div></div>
      <div className="mt-4 divide-y divide-[#e7ece9] border-y border-[#e7ece9]">
        {loading ? <p className="py-4 text-xs text-[#718079]">Loading sessions...</p> : sessions.map((session) => {
          const Icon = session.client === 'mobile' ? Smartphone : session.client === 'api' ? Server : Laptop;
          return <div key={session.id} className="flex items-center gap-3 py-3"><Icon size={15} className="shrink-0 text-[#718079]" /><div className="min-w-0 flex-1"><p className="text-xs font-medium capitalize text-[#34423d]">{session.client} {session.current ? '· This device' : ''}</p><p className="mt-0.5 truncate text-[11px] tabular-nums text-[#8b9893]">Active {new Date(session.lastActiveAt).toLocaleString('en-PH')}</p></div>{!session.current ? <Button type="button" variant="ghost" size="sm" onClick={() => revoke(session)}>Revoke</Button> : null}</div>;
        })}
        {!loading && !sessions.length ? <p className="py-4 text-xs text-[#718079]">No active sessions found.</p> : null}
      </div>
      {error ? <p className="mt-3 text-xs text-red-700">{error}</p> : null}
      <Button type="button" variant="outline" size="sm" className="mt-4 w-full" onClick={logoutAll}><LogOut size={14} />Sign out all devices</Button>
      <div className="mt-5 border-t border-[#e7ece9] pt-4">
        <div className="flex items-start gap-3"><MailCheck size={16} className="mt-0.5 text-emerald-700" /><div className="flex-1"><p className="text-xs font-medium text-[#34423d]">Email ownership</p><p className="mt-0.5 text-[11px] text-[#718079]">{user?.emailVerifiedAt ? `Verified ${new Date(user.emailVerifiedAt).toLocaleDateString('en-PH')}` : 'Verification required'}</p></div></div>
        {!user?.emailVerifiedAt ? <div className="mt-3 space-y-2"><Button type="button" variant="outline" size="sm" className="w-full" onClick={requestVerification}>Send verification</Button>{verificationToken ? <Button type="button" size="sm" className="w-full" onClick={completeDemoVerification}>Complete demo verification</Button> : null}</div> : null}
      </div>
      <form className="mt-5 border-t border-[#e7ece9] pt-4" onSubmit={submitPassword}>
        <div className="mb-3 flex items-start gap-3"><LockKeyhole size={16} className="mt-0.5 text-emerald-700" /><div><p className="text-xs font-medium text-[#34423d]">Change password</p><p className="mt-0.5 text-[11px] leading-4 text-[#718079]">All device sessions will be revoked.</p></div></div>
        <div className="space-y-2"><Input type="password" required placeholder="Current password" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} /><Input type="password" required minLength={12} placeholder="New password" value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} /><Input type="password" required minLength={12} placeholder="Confirm new password" value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} /></div>
        <Button className="mt-3 w-full" size="sm" disabled={changingPassword}>{changingPassword ? 'Updating...' : 'Update password'}</Button>
      </form>
      {message ? <p className="mt-3 text-xs leading-5 text-emerald-700">{message}</p> : null}
    </section>
  );
}
