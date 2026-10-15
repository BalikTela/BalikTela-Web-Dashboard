import { CalendarDays, CheckCircle2, Leaf, Save, ShieldCheck, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { SessionManagement } from '../components/SessionManagement';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Progress } from '../components/ui/progress';
import { Select } from '../components/ui/select';
import { useAuth } from '../context/AuthContext';
import { platformApi } from '../services/platformApi';

const textileTypes = ['Cotton', 'Polyester', 'Denim', 'Mixed fabric', 'Uniforms', 'Household linen'];

export function UserProfile() {
  const { user, updateUser, storageMode } = useAuth();
  const [form, setForm] = useState(() => ({
    ...user!,
    profile: {
      ...user!.profile,
      acceptedTextiles: [...user!.profile.acceptedTextiles],
      sustainabilityInterests: [...user!.profile.sustainabilityInterests],
    },
  }));
  const [interestText, setInterestText] = useState(form.profile.sustainabilityInterests.join(', '));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const result = await platformApi.updateProfile({
        ...form,
        profile: { ...form.profile, sustainabilityInterests: interestText.split(',').map((item) => item.trim()).filter(Boolean) },
      });
      updateUser(result.user);
      setForm(result.user);
      setMessage('Profile changes saved.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
      <aside className="space-y-4">
        <section className="surface-panel rounded-md p-5">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-[#dcece6] text-lg font-semibold text-[#205b48]">{initials(user!.fullName)}</div>
          <h2 className="mt-4 text-lg font-semibold text-[#17201d]">{user!.fullName}</h2>
          <p className="mt-1 text-sm text-[#66736e]">{user!.organization}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline">{user!.role}</Badge>
            <Badge variant="outline" className="text-emerald-700"><ShieldCheck size={12} className="mr-1" />{user!.verification}</Badge>
          </div>
          <div className="mt-5 space-y-3 border-t border-[#dfe5e2] pt-4">
            <Info icon={UserRound} label="Account ID" value={user!.id} />
            <Info icon={CalendarDays} label="Member since" value={new Date(user!.joinedAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })} />
            <Info icon={CheckCircle2} label="Storage" value={storageMode === 'supabase' ? 'Supabase connected' : storageMode === 'mongodb' ? 'Legacy MongoDB connected' : 'In-memory demo mode'} />
          </div>
        </section>

        <section className="surface-panel rounded-md p-5">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-sm font-semibold text-[#17201d]">Placeholder trust indicator</p><p className="mt-1 text-xs leading-5 text-[#718079]">Not validated. Formula, governance, thresholds, and appeal process remain research tasks.</p></div>
            <p className="text-2xl font-semibold text-[#17201d]">{user!.trustPlaceholder}</p>
          </div>
          <Progress value={user!.trustPlaceholder} className="mt-4" />
        </section>

        <section className="rounded-md border border-[#cce3d9] bg-[#edf4f1] p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-[#174b3a]"><Leaf size={15} />Research consent recorded</p>
          <p className="mt-2 text-xs leading-5 text-[#53615c]">{new Date(user!.consentAt).toLocaleString('en-PH')} · Data Privacy Act acknowledgement</p>
        </section>

        <SessionManagement />
      </aside>

      <form className="surface-panel rounded-md p-5 sm:p-6" onSubmit={submit}>
        <div className="border-b border-[#dfe5e2] pb-5"><h2 className="text-base font-semibold text-[#17201d]">Profile and participation data</h2><p className="mt-1 text-xs leading-5 text-[#718079]">Maintain the demographic, operational, and sustainability information described in the research requirements.</p></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Full name"><Input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></Field>
          <Field label="Email"><Input value={form.email} disabled /></Field>
          <Field label="Organization"><Input value={form.organization} onChange={(event) => setForm({ ...form, organization: event.target.value })} /></Field>
          <Field label="Participant role"><Input value={form.role} disabled /></Field>
          <Field label="City"><Input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></Field>
          <Field label="Region"><Select value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value })}><option>Metro Manila</option><option>Central Visayas</option><option>Western Visayas</option><option>Davao Region</option></Select></Field>
          <Field label="Age group"><Select value={form.profile.ageGroup} onChange={(event) => setForm({ ...form, profile: { ...form.profile, ageGroup: event.target.value } })}><option value="">Prefer not to specify</option><option>18–24</option><option>25–34</option><option>35–44</option><option>45–54</option><option>55+</option></Select></Field>
          <Field label="Organization size"><Select value={form.profile.organizationSize} onChange={(event) => setForm({ ...form, profile: { ...form.profile, organizationSize: event.target.value } })}><option value="">Not specified</option><option>Individual</option><option>Micro</option><option>Small</option><option>Medium</option><option>Large</option></Select></Field>
          <Field label="Reported production or handled volume (kg)"><Input type="number" min="0" value={form.profile.productionVolumeKg} onChange={(event) => setForm({ ...form, profile: { ...form.profile, productionVolumeKg: Number(event.target.value) } })} /></Field>
          <Field label="Sustainability interests"><Input value={interestText} onChange={(event) => setInterestText(event.target.value)} placeholder="Reuse, recycling, EPR readiness" /></Field>
        </div>
        <Field label="Recycling and waste-management practices"><textarea value={form.profile.recyclingPractices} onChange={(event) => setForm({ ...form, profile: { ...form.profile, recyclingPractices: event.target.value } })} className="mt-5 min-h-28 w-full rounded-md border border-input bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></Field>
        <fieldset className="mt-5">
          <legend className="text-xs font-medium text-[#53615c]">Accepted or handled textile types</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{textileTypes.map((type) => <label key={type} className="flex items-center gap-2 rounded-md border border-[#dfe5e2] p-3 text-sm text-[#53615c]"><input type="checkbox" className="accent-emerald-700" checked={form.profile.acceptedTextiles.includes(type)} onChange={(event) => setForm({ ...form, profile: { ...form.profile, acceptedTextiles: event.target.checked ? [...form.profile.acceptedTextiles, type] : form.profile.acceptedTextiles.filter((item) => item !== type) } })} />{type}</label>)}</div>
        </fieldset>
        {message ? <p className="mt-5 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-5 text-sm text-red-700">{error}</p> : null}
        <div className="mt-6 flex justify-end"><Button disabled={saving}><Save size={16} />{saving ? 'Saving…' : 'Save profile'}</Button></div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#53615c]">{label}</span>{children}</label>; }
function Info({ icon: Icon, label, value }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string }) { return <div className="flex gap-2"><Icon size={14} className="mt-0.5 text-[#8b9893]" /><div><p className="text-[10px] text-[#8b9893]">{label}</p><p className="mt-0.5 text-xs font-medium text-[#53615c]">{value}</p></div></div>; }
function initials(name: string) { return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase(); }
