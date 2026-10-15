import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Recycle, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useAuth } from '../context/AuthContext';
import { platformApi } from '../services/platformApi';
import { readAuthLink } from '../lib/authLinks';

const demoAccounts = [
  { label: 'System Administrator', email: 'admin@baliktela.demo' },
  { label: 'Government / Policy', email: 'government@baliktela.demo' },
  { label: 'Researcher / M&E', email: 'researcher@baliktela.demo' },
  { label: 'Textile Producer', email: 'producer@baliktela.demo' },
  { label: 'Textile Recycler', email: 'recycler@baliktela.demo' },
];
const showDemoAccess = import.meta.env.DEV;

type Mode = 'login' | 'register' | 'forgot' | 'password' | 'complete' | 'checking' | 'invalid';

export function AuthPage({ onAuthenticated }: { onAuthenticated?: () => void }) {
  const { login, register, error: loginError } = useAuth();
  const [link] = useState(() => readAuthLink(window.location.href));
  const [mode, setMode] = useState<Mode>(link.isCallback ? link.error ? 'invalid' : link.legacyToken ? 'password' : 'checking' : 'login');
  const [linkType, setLinkType] = useState(link.type);
  const [emailCredentials, setEmailCredentials] = useState<{ accessToken?: string; refreshToken?: string }>({});
  const resolution = useRef<ReturnType<typeof platformApi.resolveEmailLink> | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ email: showDemoAccess && !link.isCallback ? 'admin@baliktela.demo' : '', password: showDemoAccess && !link.isCallback ? 'BalikTelaDemo2026!' : '' });
  const [registration, setRegistration] = useState({ fullName: '', email: '', password: '', confirm: '', city: '', region: 'Metro Manila', consent: false });
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(link.error);

  useEffect(() => {
    if (!link.isCallback) return;
    clearAuthUrl();
    if (link.error || link.legacyToken) return;
    let cancelled = false;
    // React StrictMode repeats effects; consume a one-time email token only once.
    resolution.current ??= platformApi.resolveEmailLink({ accessToken: link.accessToken, refreshToken: link.refreshToken, tokenHash: link.tokenHash, type: link.type });
    resolution.current.then(result => {
      if (cancelled) return;
      setForm({ email: result.email, password: '' });
      setEmailCredentials({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      setLinkType(result.intent === 'confirmation' ? 'signup' : result.intent);
      setMode(result.requiresPassword ? 'password' : 'complete');
      setMessage(result.requiresPassword ? '' : 'Email confirmed. Sign in with the password you chose during registration.');
    }).catch(reason => {
      if (!cancelled) { setError(reason instanceof Error ? reason.message : 'Unable to verify this email link.'); setMode('invalid'); }
    });
    return () => { cancelled = true; };
  }, [link]);

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError('');
    try { await login(form.email, form.password); onAuthenticated?.(); }
    catch { /* Context exposes a safe authentication error. */ }
    finally { setSubmitting(false); }
  };

  const submitRegistration = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    if (registration.password !== registration.confirm) { setError('Password confirmation does not match.'); return; }
    if (!registration.consent) { setError('Data Privacy Act consent is required.'); return; }
    setSubmitting(true);
    try {
      const result = await register(registration);
      setForm({ email: registration.email, password: '' });
      setMessage(result.message);
      setMode('complete');
      clearAuthUrl();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create the account.'); }
    finally { setSubmitting(false); }
  };

  const submitForgot = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError(''); setMessage('');
    try { const result = await platformApi.forgotPassword(form.email); setMessage(result.message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to request password recovery.'); }
    finally { setSubmitting(false); }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    if (newPassword !== confirmPassword) { setError('Password confirmation does not match.'); return; }
    setSubmitting(true);
    try {
      const result = await platformApi.resetPassword({ token: link.legacyToken || undefined, ...emailCredentials }, newPassword);
      setForm(current => ({ email: result.email ?? current.email, password: '' }));
      setEmailCredentials({}); setMessage(result.message); setMode('login'); setNewPassword(''); setConfirmPassword(''); clearAuthUrl();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to set the password.'); }
    finally { setSubmitting(false); }
  };

  const resend = async () => {
    const email = registration.email || form.email;
    if (!email) { setError('Enter your email address first.'); return; }
    setSubmitting(true); setError('');
    try { setMessage((await platformApi.resendEmailVerification(email)).message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to request another confirmation email.'); }
    finally { setSubmitting(false); }
  };

  const switchMode = (next: Mode) => { setMode(next); setError(''); setMessage(''); if (next === 'login') clearAuthUrl(); };

  return (
    <main className="grid min-h-screen bg-[#f5f7f6] lg:grid-cols-2">
      <section className="hidden bg-[#193c31] p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16 2xl:p-20">
        <div className="flex items-center gap-3 2xl:gap-4"><span className="grid h-10 w-10 place-items-center rounded-md bg-white/10 2xl:h-12 2xl:w-12"><Recycle size={20} className="2xl:h-6 2xl:w-6" /></span><div><p className="font-semibold 2xl:text-lg">BalikTela</p><p className="text-xs text-white/55 2xl:text-sm">Circular Textile Network</p></div></div>
        <div className="max-w-lg 2xl:max-w-2xl"><p className="text-xs font-medium uppercase text-[#77d6b2] 2xl:text-sm">Research platform prototype</p><h1 className="mt-4 text-4xl font-semibold leading-tight 2xl:mt-5 2xl:text-5xl">Manage evidence. Monitor material flow. Inform decisions.</h1><p className="mt-5 max-w-md text-sm leading-7 text-white/65 2xl:mt-7 2xl:max-w-xl 2xl:text-base 2xl:leading-8">An institutional dashboard for administrators, producers, recyclers, researchers, and government stakeholders.</p></div>
        <div className="grid grid-cols-3 gap-4 border-t border-white/15 pt-6 text-xs text-white/55 2xl:pt-8 2xl:text-sm"><span>Verified identity</span><span>Role-aware access</span><span>Auditable sessions</span></div>
      </section>
      <section className="flex items-center justify-center p-5 sm:p-10 xl:p-16 2xl:p-20">
        <div className="auth-form w-full max-w-md xl:max-w-lg 2xl:max-w-xl">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><span className="grid h-9 w-9 place-items-center rounded-md bg-[#193c31] text-white"><Recycle size={18} /></span><p className="font-semibold text-[#17201d]">BalikTela</p></div>
          <div className="mb-7 2xl:mb-9"><p className="text-xs font-medium text-emerald-700 2xl:text-sm">SECURE PLATFORM ACCESS</p><h2 className="mt-2 text-2xl font-semibold text-[#17201d] 2xl:mt-3 2xl:text-3xl">{titleFor(mode, linkType)}</h2><p className="mt-2 text-sm leading-6 text-[#66736e] 2xl:mt-3 2xl:text-base 2xl:leading-7">{descriptionFor(mode, linkType)}</p></div>

          {mode === 'checking' ? <p role="status" className="text-sm text-[#66736e]">Verifying your secure email link...</p> : null}
          {mode === 'invalid' ? <div className="space-y-4"><Alert tone="error">{error}</Alert><Button className="w-full" onClick={() => switchMode('forgot')}>Request password setup email</Button><BackButton onClick={() => switchMode('login')} /></div> : null}

          {mode === 'login' ? <form className="space-y-4 2xl:space-y-5" onSubmit={submitLogin}>
            {showDemoAccess ? <Field label="Demo workspace"><Select value={demoAccounts.some((account) => account.email === form.email) ? form.email : ''} onChange={(event) => setForm({ ...form, email: event.target.value, password: 'BalikTelaDemo2026!' })}><option value="">Use a registered account</option>{demoAccounts.map((account) => <option key={account.email} value={account.email}>{account.label}</option>)}</Select></Field> : null}
            <Field label="Email address"><Input type="email" required autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
            <PasswordField label="Password" value={form.password} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setForm({ ...form, password: value })} autoComplete="current-password" />
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between"><button type="button" className="text-xs font-medium text-emerald-800 hover:underline 2xl:text-sm" onClick={() => switchMode('register')}>Create participant account</button><button type="button" className="text-xs font-medium text-emerald-800 hover:underline 2xl:text-sm" onClick={() => switchMode('forgot')}>Forgot password?</button></div>
            {showDemoAccess ? <div className="rounded-md border border-[#dfe5e2] bg-white p-3 text-xs text-[#66736e] 2xl:p-4 2xl:text-sm 2xl:leading-5"><p className="flex items-center gap-2 font-medium text-[#34423d]"><CheckCircle2 size={14} className="shrink-0 text-emerald-700 2xl:h-4 2xl:w-4" />Demonstration workspace</p><p className="mt-1">Demo accounts use BalikTelaDemo2026! and contain clearly labeled sample records.</p></div> : null}
            {loginError ? <Alert tone="error">{loginError}</Alert> : null}{message ? <Alert tone="success">{message}</Alert> : null}
            <Button className="h-10 w-full 2xl:h-11 2xl:text-[15px]" disabled={submitting}>{submitting ? 'Please wait...' : 'Sign in'}<ArrowRight size={16} /></Button>
          </form> : null}

          {mode === 'register' ? <form className="space-y-4 2xl:space-y-5" onSubmit={submitRegistration}>
            <Field label="Full name"><Input required autoComplete="name" value={registration.fullName} onChange={(event) => setRegistration({ ...registration, fullName: event.target.value })} /></Field>
            <Field label="Email address"><Input required type="email" autoComplete="email" value={registration.email} onChange={(event) => setRegistration({ ...registration, email: event.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="City"><Input required value={registration.city} onChange={(event) => setRegistration({ ...registration, city: event.target.value })} /></Field><Field label="Region"><Select value={registration.region} onChange={(event) => setRegistration({ ...registration, region: event.target.value })}>{['Metro Manila', 'Central Visayas', 'Western Visayas', 'Davao Region'].map((region) => <option key={region}>{region}</option>)}</Select></Field></div>
            <PasswordField label="Password" value={registration.password} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={(value) => setRegistration({ ...registration, password: value })} autoComplete="new-password" />
            <Field label="Confirm password"><Input required type="password" minLength={12} autoComplete="new-password" value={registration.confirm} onChange={(event) => setRegistration({ ...registration, confirm: event.target.value })} /></Field>
            <label className="flex items-start gap-2 text-xs leading-5 text-[#53615c]"><input className="mt-1" type="checkbox" checked={registration.consent} onChange={(event) => setRegistration({ ...registration, consent: event.target.checked })} />I consent to the collection and processing of my account and participation data under the BalikTela privacy notice.</label>
            <Alert tone="neutral">Public registration creates a participant account. Institutional roles require an administrator invitation and verification.</Alert>
            {error ? <Alert tone="error">{error}</Alert> : null}<Button className="h-10 w-full 2xl:h-11 2xl:text-[15px]" disabled={submitting}>{submitting ? 'Creating account...' : 'Create participant account'}<ArrowRight size={16} /></Button><BackButton onClick={() => switchMode('login')} />
          </form> : null}

          {mode === 'forgot' ? <form className="space-y-4 2xl:space-y-5" onSubmit={submitForgot}><Field label="Email address"><Input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field><Alert tone="neutral">For privacy, the response is the same whether or not an eligible account exists.</Alert>{message ? <Alert tone="success">{message}</Alert> : null}{error ? <Alert tone="error">{error}</Alert> : null}<Button className="h-10 w-full 2xl:h-11 2xl:text-[15px]" disabled={submitting}>{submitting ? 'Requesting...' : 'Send recovery email'}<ArrowRight size={16} /></Button><BackButton onClick={() => switchMode('login')} /></form> : null}

          {mode === 'password' ? <form className="space-y-4 2xl:space-y-5" onSubmit={submitPassword}>{form.email ? <p className="break-all text-sm text-[#53615c]">{form.email}</p> : null}<PasswordField label={linkType === 'invite' ? 'Create password' : 'New password'} value={newPassword} show={showPassword} onShow={() => setShowPassword((value) => !value)} onChange={setNewPassword} autoComplete="new-password" /><Field label="Confirm password"><Input type="password" required minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></Field><Alert tone="neutral">Use at least 12 characters with uppercase, lowercase, a number, and a symbol.</Alert>{error ? <Alert tone="error">{error}</Alert> : null}<Button className="h-10 w-full 2xl:h-11 2xl:text-[15px]" disabled={submitting}>{submitting ? 'Updating...' : linkType === 'invite' ? 'Create password' : 'Update password'}<ArrowRight size={16} /></Button><BackButton onClick={() => switchMode('login')} /></form> : null}

          {mode === 'complete' ? <div className="space-y-4 2xl:space-y-5">{message ? <Alert tone="success">{message}</Alert> : null}{error ? <Alert tone="error">{error}</Alert> : null}<Button className="w-full 2xl:h-11 2xl:text-[15px]" onClick={() => switchMode('login')}>Continue to sign in<ArrowRight size={16} /></Button><Button type="button" variant="outline" className="w-full 2xl:h-11 2xl:text-[15px]" disabled={submitting} onClick={resend}>Resend confirmation email</Button></div> : null}
          <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-[#718079] 2xl:mt-8 2xl:text-sm 2xl:leading-6"><ShieldCheck size={14} className="mt-0.5 shrink-0 2xl:h-4 2xl:w-4" />Credentials are managed by Supabase Auth; application access remains role and scope controlled.</p>
        </div>
      </section>
    </main>
  );
}

function clearAuthUrl() { window.history.replaceState({}, '', window.location.pathname); }
function titleFor(mode: Mode, type: string) { return mode === 'checking' ? 'Checking your email link' : mode === 'invalid' ? 'Email link unavailable' : mode === 'login' ? 'Sign in to your workspace' : mode === 'register' ? 'Create participant account' : mode === 'forgot' ? 'Recover your account' : mode === 'password' ? type === 'invite' ? 'Create your password' : 'Choose a new password' : 'Check your email'; }
function descriptionFor(mode: Mode, type: string) { return mode === 'checking' ? 'Your account details will appear after verification.' : mode === 'invalid' ? 'A valid email link is required to confirm your account or set a password.' : mode === 'login' ? 'Your role, organization, facility, and data scope determine the information available to you.' : mode === 'register' ? 'Register with your own email. Government, research, and institutional roles are invitation-only.' : mode === 'forgot' ? 'Supabase will send a time-limited password recovery link to an eligible account.' : mode === 'password' ? type === 'invite' ? 'Your email is confirmed. Choose a private password. Institutional access still requires administrator approval.' : 'Set a replacement password using the secure email link.' : 'Confirm your email address, then return here to sign in.'; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#53615c] 2xl:mb-2 2xl:text-sm">{label}</span>{children}</label>; }
function PasswordField({ label, value, show, onShow, onChange, autoComplete }: { label: string; value: string; show: boolean; onShow: () => void; onChange: (value: string) => void; autoComplete: string }) { return <Field label={label}><div className="relative"><Input aria-label={label} type={show ? 'text' : 'password'} required minLength={12} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} className="pr-10" /><button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" onClick={onShow} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></Field>; }
function Alert({ tone, children }: { tone: 'error' | 'success' | 'neutral'; children: React.ReactNode }) { const style = tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-[#dfe5e2] bg-white text-[#66736e]'; return <p role={tone === 'error' ? 'alert' : undefined} className={`auth-alert rounded-md border p-3 text-sm leading-5 ${style}`}>{children}</p>; }
function BackButton({ onClick }: { onClick: () => void }) { return <Button type="button" variant="ghost" className="w-full 2xl:h-11 2xl:text-[15px]" onClick={onClick}><ArrowLeft size={15} />Back to sign in</Button>; }
