import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useAuth } from '../context/AuthContext';
import { platformApi } from '../services/platformApi';
import { readAuthLink } from '../lib/authLinks';
import { AuthLayout } from '../components/AuthLayout';

type Mode = 'login' | 'forgot' | 'setup' | 'password' | 'complete' | 'checking' | 'invalid';

export function AuthPage({ onAuthenticated }: { onAuthenticated?: () => void }) {
  const { login, error: loginError } = useAuth();
  const [link] = useState(() => readAuthLink(window.location.href));
  const [mode, setMode] = useState<Mode>(link.isCallback ? link.error ? 'invalid' : link.isSetup ? 'setup' : link.legacyToken ? 'password' : 'checking' : 'login');
  const [linkType, setLinkType] = useState(link.type);
  const [setupToken, setSetupToken] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [setupPurpose, setSetupPurpose] = useState<'invite' | 'recovery'>(link.setupPurpose);
  const [resendAfter, setResendAfter] = useState(0);
  const resolution = useRef<ReturnType<typeof platformApi.resolveEmailLink> | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ email: '', password: '' });
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(link.error);
  const title = useRef<HTMLHeadingElement>(null);
  const previousMode = useRef(mode);

  useEffect(() => {
    if (previousMode.current !== mode) title.current?.focus({ preventScroll: true });
    previousMode.current = mode;
  }, [mode]);

  useEffect(() => {
    if (!link.isCallback) return;
    clearAuthUrl();
    if (link.error || link.legacyToken || link.isSetup) return;
    let cancelled = false;
    // React StrictMode repeats effects; consume a one-time email token only once.
    resolution.current ??= platformApi.resolveEmailLink({ accessToken: link.accessToken, refreshToken: link.refreshToken, tokenHash: link.tokenHash, type: link.type });
    resolution.current.then(result => {
      if (cancelled) return;
      setForm({ email: result.email, password: '' });
      setSetupToken(result.setupToken ?? '');
      setLinkType(result.intent === 'confirmation' ? 'signup' : result.intent);
      setMode(result.requiresPassword ? 'password' : 'complete');
      setMessage(result.requiresPassword ? '' : 'Email confirmed. Sign in with the password you chose during registration.');
    }).catch(reason => {
      if (!cancelled) { setError(reason instanceof Error ? reason.message : 'Unable to verify this email link.'); setMode('invalid'); }
    });
    return () => { cancelled = true; };
  }, [link]);

  useEffect(() => {
    if (!resendAfter) return;
    const timer = window.setTimeout(() => setResendAfter(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendAfter]);

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError('');
    try { await login(form.email, form.password); onAuthenticated?.(); }
    catch { /* Context exposes a safe authentication error. */ }
    finally { setSubmitting(false); }
  };

  const submitForgot = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError(''); setMessage('');
    try { const result = await platformApi.forgotPassword(form.email); setMessage(result.message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to request password recovery.'); }
    finally { setSubmitting(false); }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError(''); setMessage('');
    try {
      const result = await platformApi.verifySetupCode(form.email, setupCode, setupPurpose);
      setForm({ email: result.email, password: '' }); setSetupToken(result.setupToken);
      setSetupCode(''); setLinkType(result.intent); setMode('password');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to verify the code.'); }
    finally { setSubmitting(false); }
  };

  const requestCode = async () => {
    if (!form.email.includes('@')) { setError('Enter your email address first.'); return; }
    setSubmitting(true); setError(''); setMessage('');
    try {
      const result = await platformApi.requestSetupCode(form.email);
      setSetupPurpose('recovery'); setSetupCode(''); setSetupToken('');
      setMessage(result.message); setResendAfter(60);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to request a code.'); }
    finally { setSubmitting(false); }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    if (newPassword !== confirmPassword) { setError('Password confirmation does not match.'); return; }
    setSubmitting(true);
    try {
      const result = await platformApi.resetPassword({ token: link.legacyToken || undefined, setupToken: setupToken || undefined }, newPassword);
      setForm(current => ({ email: result.email ?? current.email, password: '' }));
      setSetupToken(''); setMessage(result.message); setMode('login'); setNewPassword(''); setConfirmPassword(''); clearAuthUrl();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to set the password.'); }
    finally { setSubmitting(false); }
  };

  const resend = async () => {
    const email = form.email;
    if (!email) { setError('Enter your email address first.'); return; }
    setSubmitting(true); setError('');
    try { setMessage((await platformApi.resendEmailVerification(email)).message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to request another confirmation email.'); }
    finally { setSubmitting(false); }
  };

  const switchMode = (next: Mode) => { setMode(next); setError(''); setMessage(''); setSetupToken(''); setNewPassword(''); setConfirmPassword(''); if (next === 'login') clearAuthUrl(); };

  return (
    <AuthLayout>
        <div key={mode} className="auth-form" aria-busy={submitting}>
          <div className="auth-form-heading"><h1 ref={title} tabIndex={-1} className="auth-title">{titleFor(mode, linkType)}</h1><p className="auth-description">{descriptionFor(mode, linkType)}</p></div>

          {mode === 'checking' ? <p role="status" className="text-sm text-[#66736e]">Verifying your secure email link...</p> : null}
          {mode === 'invalid' ? <div className="space-y-4"><Alert tone="error">{error}</Alert><Button className="w-full" onClick={() => switchMode('forgot')}>Request password setup email</Button><BackButton onClick={() => switchMode('login')} /></div> : null}

          {mode === 'login' ? <form className="space-y-4 2xl:space-y-5" onSubmit={submitLogin}>
            <Field label="Email address"><Input type="email" required autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
            <PasswordField label="Password" value={form.password} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setForm({ ...form, password: value })} autoComplete="current-password" action={<button type="button" className="auth-text-link" onClick={() => switchMode('forgot')}>Forgot password?</button>} />
            {loginError ? <Alert tone="error">{loginError}</Alert> : null}{message ? <Alert tone="success">{message}</Alert> : null}
            <Button className="auth-submit w-full" disabled={submitting}>{submitting ? 'Signing in...' : 'Sign in'}{submitting ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}</Button>
            <div className="auth-secondary-action"><Button type="button" variant="outline" className="w-full" onClick={() => { setForm(current => ({ ...current, password: '' })); setSetupPurpose('invite'); switchMode('setup'); }}><KeyRound size={16} aria-hidden="true" />Have an invitation or setup code?</Button></div>
          </form> : null}

          {mode === 'setup' ? <form className="space-y-4 2xl:space-y-5" onSubmit={submitCode}>
            <Field label="Email address"><Input type="email" required autoComplete="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></Field>
            <Field label="Code from email"><Input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} value={setupCode} onChange={event => setSetupCode(event.target.value.replace(/\D/g, '').slice(0, 10))} className="font-mono tabular-nums" /></Field>
            <Field label="Email type"><Select value={setupPurpose} onChange={event => setSetupPurpose(event.target.value as 'invite' | 'recovery')}><option value="invite">Original invitation</option><option value="recovery">New setup / recovery code</option></Select></Field>
            <Alert tone="neutral">Codes expire after 10 minutes and can be used once. You will create your private password next. Institutional access still requires administrator approval.</Alert>
            {error ? <Alert tone="error">{error}</Alert> : null}{message ? <Alert tone="success">{message}</Alert> : null}
            <Button className="h-10 w-full" disabled={submitting}>{submitting ? 'Please wait...' : 'Verify code'}<ArrowRight size={16} /></Button>
            <Button type="button" variant="outline" className="w-full" disabled={submitting || resendAfter > 0} onClick={requestCode}>{resendAfter > 0 ? `Request another code in ${resendAfter}s` : 'Request a new code'}</Button>
            <BackButton onClick={() => switchMode('login')} />
          </form> : null}

          {mode === 'forgot' ? <form className="space-y-4 2xl:space-y-5" onSubmit={submitForgot}><Field label="Email address"><Input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field><Alert tone="neutral">For privacy, the response is the same whether or not an eligible account exists.</Alert>{message ? <Alert tone="success">{message}</Alert> : null}{error ? <Alert tone="error">{error}</Alert> : null}<Button className="h-10 w-full 2xl:h-11 2xl:text-[15px]" disabled={submitting}>{submitting ? 'Requesting...' : 'Send recovery email'}<ArrowRight size={16} /></Button><Button type="button" variant="outline" className="w-full" onClick={() => { setSetupPurpose('recovery'); switchMode('setup'); }}>Enter recovery code</Button><BackButton onClick={() => switchMode('login')} /></form> : null}

          {mode === 'password' ? <form className="space-y-4 2xl:space-y-5" onSubmit={submitPassword}>{form.email ? <p className="break-all text-sm text-[#53615c]">{form.email}</p> : null}<PasswordField label={linkType === 'invite' ? 'Create password' : 'New password'} value={newPassword} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={setNewPassword} autoComplete="new-password" /><Field label="Confirm password"><Input type="password" required minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></Field><Alert tone="neutral">Use at least 12 characters with uppercase, lowercase, a number, and a symbol.</Alert>{error ? <Alert tone="error">{error}</Alert> : null}<Button className="h-10 w-full 2xl:h-11 2xl:text-[15px]" disabled={submitting}>{submitting ? 'Updating...' : linkType === 'invite' ? 'Create password' : 'Update password'}<ArrowRight size={16} /></Button><BackButton onClick={() => switchMode('login')} /></form> : null}

          {mode === 'complete' ? <div className="space-y-4 2xl:space-y-5">{message ? <Alert tone="success">{message}</Alert> : null}{error ? <Alert tone="error">{error}</Alert> : null}<Button className="w-full 2xl:h-11 2xl:text-[15px]" onClick={() => switchMode('login')}>Continue to sign in<ArrowRight size={16} /></Button><Button type="button" variant="outline" className="w-full 2xl:h-11 2xl:text-[15px]" disabled={submitting} onClick={resend}>Resend confirmation email</Button></div> : null}
        </div>
    </AuthLayout>
  );
}

function clearAuthUrl() { window.history.replaceState({}, '', window.location.pathname); }
function titleFor(mode: Mode, type: string) { return mode === 'setup' ? 'Set up your account' : mode === 'checking' ? 'Checking your email link' : mode === 'invalid' ? 'Email link unavailable' : mode === 'login' ? 'Sign in to your workspace' : mode === 'forgot' ? 'Recover your account' : mode === 'password' ? type === 'invite' ? 'Create your password' : 'Choose a new password' : 'Check your email'; }
function descriptionFor(mode: Mode, type: string) { return mode === 'setup' ? 'Enter your email and the single-use code sent to you. No temporary password is required.' : mode === 'checking' ? 'Your account details will appear after verification.' : mode === 'invalid' ? 'A valid email link is required to confirm your account or set a password.' : mode === 'login' ? 'Sign in with your approved institutional account.' : mode === 'forgot' ? 'Request a secure recovery email for your account.' : mode === 'password' ? type === 'invite' ? 'Your email is confirmed. Choose a private password. Institutional access still requires administrator approval.' : 'Set a replacement password after verifying your email.' : 'Confirm your email address, then return here to sign in.'; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="auth-field"><span>{label}</span>{children}</label>; }
function PasswordField({ label, value, show, onShow, onChange, autoComplete, action }: { label: string; value: string; show: boolean; onShow: () => void; onChange: (value: string) => void; autoComplete: string; action?: ReactNode }) {
  const id = useId();
  return <div className="auth-field"><div className="auth-field-label"><label htmlFor={id}>{label}</label>{action}</div><div className="relative"><Input id={id} aria-label={label} type={show ? 'text' : 'password'} required minLength={12} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} className="pr-12" /><button type="button" className="auth-password-toggle" onClick={onShow} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'} aria-pressed={show}>{show ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}</button></div></div>;
}
function Alert({ tone, children }: { tone: 'error' | 'success' | 'neutral'; children: React.ReactNode }) { const style = tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-[#dfe5e2] bg-white text-[#66736e]'; return <p role={tone === 'error' ? 'alert' : undefined} className={`auth-alert rounded-md border p-3 text-sm leading-5 ${style}`}>{children}</p>; }
function BackButton({ onClick }: { onClick: () => void }) { return <Button type="button" variant="ghost" className="w-full 2xl:h-11 2xl:text-[15px]" onClick={onClick}><ArrowLeft size={15} />Back to sign in</Button>; }
