import { ArrowRight, CheckCircle2, Clock3, MessageSquare, Plus, Store, Waypoints } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { useAuth } from '../context/AuthContext';
import type { BarterListing, BarterOffer, Conversation, WalletEntry } from '../platformTypes';
import { platformApi } from '../services/platformApi';
import type { ParticipantPageKey } from './ParticipantLayout';

interface OverviewData {
  listings: BarterListing[];
  offers: BarterOffer[];
  conversations: Conversation[];
  wallet: { balance: number; entries: WalletEntry[] };
}

export function ParticipantOverview({ onNavigate }: { onNavigate: (page: ParticipantPageKey) => void }) {
  const { user } = useAuth();
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const [listingResult, offerResult, conversationResult, wallet] = await Promise.all([platformApi.listings(), platformApi.offers(), platformApi.conversations(), platformApi.wallet()]);
      setData({ listings: listingResult.listings, offers: offerResult.offers, conversations: conversationResult.conversations, wallet });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load the participant workspace.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const model = useMemo(() => {
    if (!data || !user) return null;
    const ownListings = data.listings.filter((item) => item.ownerId === user.id);
    const available = data.listings.filter((item) => item.ownerId !== user.id && ['Open', 'Matched'].includes(item.status));
    const pending = data.offers.filter((item) => item.status === 'Pending');
    const acceptedKg = data.offers.filter((item) => item.status === 'Accepted').reduce((sum, item) => sum + item.quantityKg, 0);
    return { ownListings, available, pending, acceptedKg };
  }, [data, user]);

  if (error) return <div className="rounded-md border border-red-200 bg-red-50 p-5 text-sm text-red-700"><p>{error}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>Try again</Button></div>;
  if (!data || !model) return <div className="grid min-h-[420px] place-items-center text-sm text-[#718079]">Loading your material workspace…</div>;

  const isProducer = user?.role === 'Producer';
  return (
    <div className="space-y-5">
      <section className="grid overflow-hidden rounded-md border border-[#dce4e0] bg-white lg:grid-cols-[1.45fr_1fr_1fr_1fr]">
        <div className="border-b border-[#dce4e0] p-5 lg:border-b-0 lg:border-r">
          <p className="text-xs font-medium text-[#66736e]">{isProducer ? 'Material recorded in my listings' : 'Available material in the marketplace'}</p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <p className="text-4xl font-semibold tracking-normal">{(isProducer ? model.ownListings : model.available).reduce((sum, item) => sum + (item.quantityKg ?? 0), 0).toLocaleString()} <span className="text-sm font-normal text-[#718079]">kg</span></p>
            <Waypoints size={22} className="text-emerald-700" />
          </div>
          <p className="mt-3 text-xs leading-5 text-[#718079]">Current sample records associated with this workspace. Not verified recovered weight.</p>
        </div>
        <Metric label={isProducer ? 'My active listings' : 'Available listings'} value={isProducer ? model.ownListings.filter((item) => ['Open', 'Matched'].includes(item.status)).length : model.available.length} detail="Current marketplace records" />
        <Metric label="Pending offers" value={model.pending.length} detail="Incoming and outgoing" />
        <Metric label="Demo credit balance" value={data.wallet.balance.toLocaleString()} detail="No cash value" />
      </section>

      <section className="grid items-start gap-5 xl:grid-cols-[1.5fr_0.9fr]">
        <div className="surface-panel rounded-md">
          <header className="flex items-center justify-between gap-4 border-b border-[#e7ece9] p-5">
            <div><h2 className="text-sm font-semibold">Available textile materials</h2><p className="mt-1 text-xs text-[#718079]">Recently published sample listings</p></div>
            <Button variant="outline" size="sm" onClick={() => onNavigate('marketplace')}>Browse all<ArrowRight size={14} /></Button>
          </header>
          <div className="divide-y divide-[#e7ece9]">
            {model.available.slice(0, 4).map((listing) => <button type="button" key={listing.id} onClick={() => onNavigate('marketplace')} className="data-row grid w-full gap-3 p-4 text-left hover:bg-[#f8faf9] sm:grid-cols-[1fr_auto] sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{listing.title}</p><Badge variant="outline">{listing.textileType}</Badge></div><p className="mt-1 truncate text-xs text-[#718079]">{listing.ownerName} · {listing.city}, {listing.region}</p></div><div className="text-left sm:text-right"><p className="text-sm font-semibold">{listing.quantityKg === null ? 'Awaiting weighing' : `${listing.quantityKg.toLocaleString()} kg`}</p><p className="mt-1 text-xs text-[#718079]">{listing.quality}</p></div></button>)}
            {!model.available.length ? <p className="p-8 text-center text-sm text-[#718079]">No available materials are recorded.</p> : null}
          </div>
        </div>

        <div className="space-y-5">
          <section className="surface-panel rounded-md p-5">
            <h2 className="text-sm font-semibold">Next actions</h2>
            <div className="mt-4 grid gap-2">
              <QuickAction icon={isProducer ? Plus : Store} label={isProducer ? 'List available material' : 'Find reusable material'} detail={isProducer ? 'Publish textile quantity and exchange terms' : 'Search by type, condition, or location'} onClick={() => onNavigate(isProducer ? 'inventory' : 'marketplace')} />
              <QuickAction icon={Clock3} label="Review pending offers" detail={`${model.pending.length} proposal${model.pending.length === 1 ? '' : 's'} require attention`} onClick={() => onNavigate('activity')} />
              <QuickAction icon={MessageSquare} label="Open conversations" detail={`${data.conversations.length} exchange thread${data.conversations.length === 1 ? '' : 's'}`} onClick={() => onNavigate('messages')} />
            </div>
          </section>

          <section className="rounded-md border border-[#cfe1d8] bg-[#eef5f1] p-5">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium text-emerald-800">RECORDED PARTICIPATION</p><p className="mt-2 text-2xl font-semibold">{model.acceptedKg.toLocaleString()} kg</p></div><CheckCircle2 size={20} className="text-emerald-700" /></div>
            <p className="mt-3 text-xs leading-5 text-[#53615c]">Accepted offer quantity in this demo account. This does not confirm collection, receipt, recycling, or environmental impact.</p>
            <button type="button" className="mt-4 flex items-center gap-1.5 text-xs font-medium text-emerald-800" onClick={() => onNavigate('impact')}>Review calculation notes<ArrowRight size={13} /></button>
          </section>
        </div>
      </section>

      <section className="surface-panel rounded-md">
        <header className="flex items-center justify-between gap-4 border-b border-[#e7ece9] p-5"><div><h2 className="text-sm font-semibold">Offer activity</h2><p className="mt-1 text-xs text-[#718079]">Latest proposals connected to this account</p></div><Button variant="ghost" size="sm" onClick={() => onNavigate('activity')}>View activity<ArrowRight size={14} /></Button></header>
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr><th className="px-5">Material</th><th>Direction</th><th>Quantity</th><th>Pending credits</th><th>Status</th><th className="px-5">Updated</th></tr></thead><tbody className="divide-y divide-[#e7ece9]">{data.offers.slice(0, 5).map((offer) => <tr key={offer.id}><td className="px-5 py-3 font-medium">{offer.listingTitle}</td><td>{offer.providerId === user?.id ? 'Incoming' : 'Outgoing'}</td><td>{offer.quantityKg} kg</td><td>{offer.offeredCredits.toLocaleString()}</td><td><Badge variant="outline">{offer.status}</Badge></td><td className="px-5 text-xs text-[#718079]">{formatDate(offer.updatedAt)}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) { return <div className="border-b border-[#dce4e0] p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"><p className="text-xs text-[#66736e]">{label}</p><p className="mt-3 text-2xl font-semibold">{value}</p><p className="mt-2 text-xs text-[#718079]">{detail}</p></div>; }
function QuickAction({ icon: Icon, label, detail, onClick }: { icon: React.ComponentType<{ size?: number }>; label: string; detail: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="surface-panel-interactive flex items-center gap-3 rounded-md border border-[#e1e7e4] p-3 text-left"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#e6f0eb] text-emerald-800"><Icon size={17} /></span><span className="min-w-0 flex-1"><span className="block text-xs font-medium">{label}</span><span className="mt-0.5 block truncate text-[11px] text-[#718079]">{detail}</span></span><ArrowRight size={14} className="text-[#8b9893]" /></button>; }
function formatDate(value: string) { return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(value)); }
