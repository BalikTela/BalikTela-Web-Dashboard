import { ArrowRight, Check, Coins, Inbox, ListFilter, MessageSquare, Plus, Search, Sparkles, Waypoints, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import type { BarterListing, BarterOffer, ChatMessage, Conversation, Transfer, WalletEntry } from '../platformTypes';
import { platformApi } from '../services/platformApi';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { EmptyBlock } from '../components/StateBlock';

export type BarterTab = 'Marketplace' | 'Offers' | 'Transfers' | 'Messages' | 'Wallet';

interface BarterExchangeProps {
  initialTab?: BarterTab;
  lockedTab?: boolean;
  listingScope?: 'all' | 'mine';
  title?: string;
  description?: string;
}

export function BarterExchange({ initialTab = 'Marketplace', lockedTab = false, listingScope = 'all', title = 'Barter Exchange', description = 'List textile materials, review compatible matches, agree terms, and retain an audit trail.' }: BarterExchangeProps = {}) {
  const { user } = useAuth();
  const [tab, setTab] = useState<BarterTab>(initialTab);
  const [listings, setListings] = useState<BarterListing[]>([]);
  const [offers, setOffers] = useState<BarterOffer[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [wallet, setWallet] = useState<{ balance: number; entries: WalletEntry[] }>({ balance: 0, entries: [] });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [offerTarget, setOfferTarget] = useState<BarterListing | null>(null);
  const [matchTarget, setMatchTarget] = useState<BarterListing | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [listingResult, offerResult, transferResult, conversationResult, walletResult] = await Promise.all([platformApi.listings(), platformApi.offers(), platformApi.transfers(), platformApi.conversations(), platformApi.wallet()]);
      setListings(listingResult.listings); setOffers(offerResult.offers); setTransfers(transferResult.transfers); setConversations(conversationResult.conversations); setWallet(walletResult);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load barter activity.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const visibleListings = useMemo(() => listings
    .filter((item) => listingScope === 'all' || item.ownerId === user?.id)
    .filter((item) => [item.title, item.ownerName, item.textileType, item.city].join(' ').toLowerCase().includes(query.toLowerCase())), [listingScope, listings, query, user?.id]);
  const pendingOffers = offers.filter((item) => item.status === 'Pending').length;

  return (
    <div className="space-y-5">
      <section className="grid overflow-hidden rounded-md border border-[#dfe5e2] bg-white sm:grid-cols-4 sm:divide-x sm:divide-[#dfe5e2]">
        <TopMetric label="Open listings" value={listings.filter((item) => item.status === 'Open').length} detail="Available for exchange" />
        <TopMetric label="My listings" value={listings.filter((item) => item.ownerId === user?.id).length} detail="Created by this account" />
        <TopMetric label="Active transfers" value={transfers.filter((item) => !['Completed', 'Cancelled', 'Rejected'].includes(item.status)).length} detail="Awaiting lifecycle evidence" />
        <TopMetric label="Reward balance" value={wallet.balance.toLocaleString()} detail="Reward credits" accent />
      </section>

      <section className="surface-panel overflow-hidden rounded-md">
        <header className="flex flex-col gap-4 border-b border-[#dfe5e2] p-5 lg:flex-row lg:items-center lg:justify-between">
          <div><h2 className="text-base font-semibold text-[#17201d]">{title}</h2><p className="mt-1 text-xs text-[#718079]">{description}</p></div>
          {!lockedTab ? <div className="flex max-w-full overflow-x-auto rounded-md bg-[#f1f4f2] p-1">{(['Marketplace', 'Offers', 'Transfers', 'Messages', 'Wallet'] as BarterTab[]).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={cn('h-8 whitespace-nowrap rounded px-3 text-xs font-medium', tab === item ? 'bg-white text-[#17201d] ring-1 ring-[#dfe5e2]' : 'text-[#66736e]')}>{item}{item === 'Offers' && pendingOffers ? <span className="ml-1.5 text-emerald-700">{pendingOffers}</span> : null}</button>)}</div> : null}
        </header>
        {error ? <p className="m-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {loading ? <div className="grid min-h-80 place-items-center text-sm text-[#718079]">Loading exchange workspace…</div> : null}
        {!loading && tab === 'Marketplace' ? <Marketplace listings={visibleListings} query={query} setQuery={setQuery} userId={user!.id} onCreate={() => setCreating(true)} onOffer={setOfferTarget} onMatches={setMatchTarget} /> : null}
        {!loading && tab === 'Offers' ? <Offers offers={offers} userId={user!.id} onDecide={async (offerId, status) => { await platformApi.decideOffer(offerId, status); await load(); }} /> : null}
        {!loading && tab === 'Transfers' ? <Transfers transfers={transfers} userId={user!.id} isAdmin={user!.role === 'Administrator'} onAdvance={async (transferId, body) => { await platformApi.advanceTransfer(transferId, body); await load(); }} /> : null}
        {!loading && tab === 'Messages' ? <Messages conversations={conversations} userId={user!.id} /> : null}
        {!loading && tab === 'Wallet' ? <Wallet balance={wallet.balance} entries={wallet.entries} /> : null}
      </section>
      {creating ? <CreateListingDialog onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await load(); }} /> : null}
      {offerTarget ? <OfferDialog listing={offerTarget} onClose={() => setOfferTarget(null)} onCreated={async () => { setOfferTarget(null); await load(); setTab('Offers'); }} /> : null}
      {matchTarget ? <MatchesDialog listing={matchTarget} onClose={() => setMatchTarget(null)} onOffer={(listing) => { setMatchTarget(null); setOfferTarget(listing); }} /> : null}
    </div>
  );
}

function Marketplace({ listings, query, setQuery, userId, onCreate, onOffer, onMatches }: { listings: BarterListing[]; query: string; setQuery: (value: string) => void; userId: string; onCreate: () => void; onOffer: (listing: BarterListing) => void; onMatches: (listing: BarterListing) => void }) {
  return <div className="p-5"><div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><label className="relative block max-w-sm flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search materials, organizations, or locations" className="pl-9" /></label><Button onClick={onCreate}><Plus size={16} />New listing</Button></div>{listings.length ? <div className="grid gap-3 xl:grid-cols-2">{listings.map((listing) => <ListingCard key={listing.id} listing={listing} own={listing.ownerId === userId} onOffer={() => onOffer(listing)} onMatches={() => onMatches(listing)} />)}</div> : <EmptyBlock label="No barter listings match this search." />}</div>;
}

function ListingCard({ listing, own, onOffer, onMatches }: { listing: BarterListing; own: boolean; onOffer: () => void; onMatches: () => void }) {
  return <article className="surface-panel-interactive rounded-md border border-[#dfe5e2] p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap gap-2"><Badge variant="outline">{listing.textileType}</Badge><Badge variant="outline" className={statusTone(listing.status)}>{listing.status}</Badge><Badge variant="outline">{listing.weightStatus}</Badge></div><h3 className="mt-3 text-base font-semibold text-[#17201d]">{listing.title}</h3><p className="mt-1 text-xs text-[#718079]">{listing.ownerName} · {listing.city}, {listing.region}</p><p className="mt-1 text-[10px] text-[#8b9893]">Batch {listing.batchId}</p></div><p className="shrink-0 text-right text-xl font-semibold tabular-nums text-[#17201d]">{listing.quantityKg}<span className="ml-1 text-xs font-normal text-[#718079]">kg</span></p></div><p className="mt-4 line-clamp-2 text-sm leading-6 text-[#53615c]">{listing.description}</p><div className="mt-4 grid gap-3 border-y border-[#edf0ee] py-3 text-xs sm:grid-cols-4"><Mini label="Condition" value={listing.quality} /><Mini label="Source / form" value={`${listing.wasteSource} · ${listing.wasteForm}`} /><Mini label="Pathway" value={listing.circularPathway} /><Mini label="Exchange for" value={listing.exchangeFor} /></div><div className="mt-4 flex flex-wrap items-center justify-between gap-2"><button type="button" onClick={onMatches} className="flex items-center gap-1.5 text-xs font-medium text-emerald-700"><Sparkles size={14} />Compatible matches</button>{own ? <span className="text-xs text-[#718079]">Your listing</span> : <Button size="sm" variant="outline" disabled={!['Open', 'Matched'].includes(listing.status)} onClick={onOffer}>Make offer<ArrowRight size={14} /></Button>}</div></article>;
}

function Offers({ offers, userId, onDecide }: { offers: BarterOffer[]; userId: string; onDecide: (id: string, status: 'Accepted' | 'Declined') => Promise<void> }) {
  const [busy, setBusy] = useState('');
  return <div className="p-5">{offers.length ? <div className="divide-y divide-[#dfe5e2] border-y border-[#dfe5e2]">{offers.map((offer) => { const incoming = offer.providerId === userId; return <article key={offer.id} className="grid gap-4 py-4 lg:grid-cols-[1fr_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-[#17201d]">{offer.listingTitle}</p><Badge variant="outline" className={offer.status === 'Accepted' ? 'text-emerald-700' : offer.status === 'Declined' ? 'text-red-700' : 'text-amber-700'}>{offer.status}</Badge><span className="text-xs text-[#718079]">{incoming ? 'Incoming' : 'Outgoing'}</span></div><p className="mt-1 text-sm text-[#53615c]">{offer.quantityKg} kg · {offer.offeredCredits} pending credits · recipient: {offer.recipientName}</p><p className="mt-2 text-xs leading-5 text-[#718079]">Terms: {offer.terms}</p></div>{incoming && offer.status === 'Pending' ? <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy === offer.id} onClick={async () => { setBusy(offer.id); await onDecide(offer.id, 'Declined'); setBusy(''); }}><X size={14} />Decline</Button><Button size="sm" disabled={busy === offer.id} onClick={async () => { setBusy(offer.id); await onDecide(offer.id, 'Accepted'); setBusy(''); }}><Check size={14} />Accept and reserve</Button></div> : null}</article>; })}</div> : <EmptyBlock label="No offers are associated with this account yet." />}</div>;
}

function Transfers({ transfers, userId, isAdmin, onAdvance }: { transfers: Transfer[]; userId: string; isAdmin: boolean; onAdvance: (id: string, body: Record<string, unknown>) => Promise<void> }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const nextAction = (transfer: Transfer) => {
    if (transfer.status === 'Reserved' && (isAdmin || transfer.providerId === userId)) return { action: 'handover', label: 'Record handover', weightKg: transfer.agreedWeightKg };
    if (transfer.status === 'Handed over' && (isAdmin || transfer.recipientId === userId)) return { action: 'receipt', label: 'Confirm receipt', weightKg: transfer.handoverWeightKg };
    if (transfer.status === 'Received' && (isAdmin || transfer.recipientId === userId)) return { action: 'validate', label: 'Validate weight', weightKg: transfer.receiptWeightKg };
    if (transfer.status === 'Validated' && (isAdmin || transfer.recipientId === userId)) return { action: 'complete', label: 'Record outcome', circularOutcome: 'For assessment' };
    return null;
  };
  const advance = async (transfer: Transfer, action: NonNullable<ReturnType<typeof nextAction>>) => { setBusy(transfer.id); setError(''); try { await onAdvance(transfer.id, { ...action, method: 'Recorded platform scale', location: 'Demo recorded location', discrepancyReason: 'No discrepancy', note: 'Lifecycle evidence recorded in the demo workspace.' }); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update transfer.'); } finally { setBusy(''); } };
  return <div className="p-5">{error ? <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}{transfers.length ? <div className="space-y-4">{transfers.map((transfer) => { const action = nextAction(transfer); return <article key={transfer.id} className="rounded-md border border-[#dfe5e2] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-[#17201d]">{transfer.id}</p><Badge variant="outline" className={transfer.status === 'Completed' ? 'text-emerald-700' : transfer.status === 'Disputed' ? 'text-red-700' : 'text-amber-700'}>{transfer.status}</Badge><span className="text-xs text-[#718079]">Batch {transfer.batchId}</span></div><p className="mt-2 text-sm text-[#53615c]">{transfer.materialCategory} · agreed {transfer.agreedWeightKg} kg · verified {transfer.verifiedWeightKg ?? 'Pending'}{transfer.verifiedWeightKg ? ' kg' : ''}</p><p className="mt-1 text-xs text-[#718079]">Reward: {transfer.rewardIssuedAt ? `${transfer.pendingRewardCredits} credits issued after completion` : `${transfer.pendingRewardCredits} credits pending validation`}</p></div>{action ? <Button size="sm" disabled={busy === transfer.id} onClick={() => void advance(transfer, action)}><Waypoints size={14} />{busy === transfer.id ? 'Recording…' : action.label}</Button> : null}</div><div className="mt-4 grid gap-0 border-t border-[#e7ece9] sm:grid-cols-5">{transfer.events.map((event) => <div key={event.id} className="relative border-b border-[#e7ece9] py-3 pr-4 sm:border-b-0 sm:border-r sm:pl-4 sm:first:pl-0 sm:last:border-r-0"><p className="text-[10px] font-semibold uppercase text-emerald-700">{event.type}</p><p className="mt-1 text-xs text-[#53615c]">{event.note}</p><p className="mt-1 text-[10px] text-[#8b9893]">{formatDate(event.timestamp)} · {event.actorName}</p></div>)}</div>{transfer.discrepancyKg ? <p className="mt-3 text-xs text-amber-700">Receipt discrepancy: {transfer.discrepancyKg > 0 ? '+' : ''}{transfer.discrepancyKg} kg · {transfer.discrepancyReason}</p> : null}</article>; })}</div> : <EmptyBlock label="Accepted offers create reserved transfers here. Handover and receipt must be recorded before validation and completion." />}</div>;
}

function Messages({ conversations, userId }: { conversations: Conversation[]; userId: string }) {
  const [selected, setSelected] = useState(conversations[0]?.id ?? '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const loadMessages = useCallback(async (id: string) => { if (!id) return; try { const result = await platformApi.messages(id); setMessages(result.messages); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load messages.'); } }, []);
  useEffect(() => { void loadMessages(selected); }, [loadMessages, selected]);
  if (!conversations.length) return <div className="p-5"><EmptyBlock label="A chat thread will appear after an offer is created." /></div>;
  return <div className="grid min-h-[520px] lg:grid-cols-[280px_1fr]"><aside className="border-b border-[#dfe5e2] lg:border-b-0 lg:border-r"><p className="border-b border-[#edf0ee] p-4 text-xs font-medium text-[#718079]">CONVERSATIONS</p>{conversations.map((conversation) => <button key={conversation.id} type="button" onClick={() => setSelected(conversation.id)} className={cn('block w-full border-b border-[#edf0ee] p-4 text-left', selected === conversation.id ? 'bg-[#edf4f1]' : 'hover:bg-[#f7f9f8]')}><p className="truncate text-sm font-medium text-[#17201d]">{conversation.listingTitle}</p><p className="mt-1 truncate text-xs text-[#718079]">{conversation.participantNames.join(' · ')}</p></button>)}</aside><section className="flex min-h-[420px] flex-col"><div className="flex-1 space-y-3 overflow-y-auto p-5">{error ? <p className="text-sm text-red-700">{error}</p> : null}{messages.map((message) => <div key={message.id} className={cn('max-w-[80%] rounded-md px-3 py-2 text-sm', message.senderId === userId ? 'ml-auto bg-[#193c31] text-white' : 'bg-[#f1f4f2] text-[#34423d]')}><p>{message.body}</p><p className={cn('mt-1 text-[10px]', message.senderId === userId ? 'text-white/55' : 'text-[#8b9893]')}>{message.senderName} · {formatDate(message.createdAt)}</p></div>)}</div><form className="flex gap-2 border-t border-[#dfe5e2] p-4" onSubmit={async (event) => { event.preventDefault(); if (!body.trim()) return; await platformApi.sendMessage(selected, body); setBody(''); await loadMessages(selected); }}><Input value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a message about collection, validation, or terms" /><Button size="icon" aria-label="Send message"><ArrowRight size={16} /></Button></form></section></div>;
}

function Wallet({ balance, entries }: { balance: number; entries: WalletEntry[] }) { return <div className="grid gap-6 p-5 lg:grid-cols-[280px_1fr]"><div className="rounded-md bg-[#193c31] p-5 text-white"><Coins size={20} className="text-[#77d6b2]" /><p className="mt-8 text-xs text-white/55">Available credits</p><p className="mt-2 text-4xl font-semibold">{balance.toLocaleString()}</p><p className="mt-3 text-xs leading-5 text-white/55">Credits are a prototype incentive ledger and have no monetary value.</p></div><div><h3 className="text-sm font-semibold text-[#17201d]">Reward activity</h3><div className="mt-3 divide-y divide-[#dfe5e2] border-y border-[#dfe5e2]">{entries.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-medium text-[#34423d]">{entry.description}</p><p className="mt-1 text-xs text-[#718079]">{entry.type} · {formatDate(entry.createdAt)}</p></div><p className={cn('font-semibold', entry.credits >= 0 ? 'text-emerald-700' : 'text-[#17201d]')}>{entry.credits >= 0 ? '+' : ''}{entry.credits}</p></div>)}</div></div></div>; }

function CreateListingDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({ title: '', description: '', textileType: 'Cotton', wasteSource: 'Post-consumer', wasteForm: 'Garments', circularPathway: 'Reuse', weightStatus: 'Estimated', measurementMethod: 'Participant estimate', quantityKg: 1, quality: 'Reusable', exchangeFor: '', rewardCredits: 2 });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <Dialog title="Create material listing" subtitle="Register the material batch, measurement provenance, and intended circular pathway." onClose={onClose}><form className="space-y-4" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await platformApi.createListing(form); await onCreated(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create listing.'); } finally { setBusy(false); } }}><Field label="Listing title"><Input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field><Field label="Description"><textarea required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="min-h-24 w-full rounded-md border border-input bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Material category"><Select value={form.textileType} onChange={(event) => setForm({ ...form, textileType: event.target.value })}>{['Cotton','Polyester','Denim','Mixed fabric','Uniforms','Household linen'].map((item) => <option key={item}>{item}</option>)}</Select></Field><Field label="Condition"><Select value={form.quality} onChange={(event) => setForm({ ...form, quality: event.target.value })}><option>Reusable</option><option>Recyclable</option><option>For assessment</option></Select></Field><Field label="Waste source"><Select value={form.wasteSource} onChange={(event) => setForm({ ...form, wasteSource: event.target.value })}>{['Pre-consumer','Post-consumer','Obsolete inventory','Household','Institutional','Unknown'].map((item) => <option key={item}>{item}</option>)}</Select></Field><Field label="Waste form"><Select value={form.wasteForm} onChange={(event) => setForm({ ...form, wasteForm: event.target.value })}>{['Garments','Offcuts','Fabric rolls','Fiber','Mixed textiles','Other'].map((item) => <option key={item}>{item}</option>)}</Select></Field><Field label="Circular pathway"><Select value={form.circularPathway} onChange={(event) => setForm({ ...form, circularPathway: event.target.value })}>{['Reuse','Repair','Redistribution','Upcycling','Recycling','For assessment'].map((item) => <option key={item}>{item}</option>)}</Select></Field><Field label="Weight status"><Select value={form.weightStatus} onChange={(event) => setForm({ ...form, weightStatus: event.target.value, measurementMethod: event.target.value === 'Estimated' ? 'Participant estimate' : 'Recorded scale' })}><option>Estimated</option><option>Measured</option><option>Verified</option></Select></Field><Field label="Quantity (kg)"><Input type="number" min="0.1" step="0.1" value={form.quantityKg} onChange={(event) => setForm({ ...form, quantityKg: Number(event.target.value) })} /></Field><Field label="Measurement method"><Input required value={form.measurementMethod} onChange={(event) => setForm({ ...form, measurementMethod: event.target.value })} /></Field></div><Field label="Requested exchange or service"><Input required value={form.exchangeFor} onChange={(event) => setForm({ ...form, exchangeFor: event.target.value })} placeholder="Collection service, repair voucher, materials…" /></Field>{error ? <p className="text-sm text-red-700">{error}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? 'Creating…' : 'Register batch and publish'}</Button></div></form></Dialog>;
}

function OfferDialog({ listing, onClose, onCreated }: { listing: BarterListing; onClose: () => void; onCreated: () => Promise<void> }) {
  const [quantityKg, setQuantityKg] = useState(listing.quantityKg); const [terms, setTerms] = useState('Pickup and validation within five working days.'); const [credits, setCredits] = useState(listing.rewardCredits); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  if (listing.quantityKg === null || quantityKg === null) return <Dialog title="Awaiting Hub weighing" subtitle={listing.title} onClose={onClose}><p className="text-sm">A recorded weight is required before a material request can be made.</p></Dialog>;
  return <Dialog title="Make an offer" subtitle={`${listing.title} · ${listing.quantityKg} kg available`} onClose={onClose}><form className="space-y-4" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await platformApi.createOffer(listing.id, { quantityKg, terms, offeredCredits: credits }); await onCreated(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create offer.'); } finally { setBusy(false); } }}><div className="grid gap-4 sm:grid-cols-2"><Field label="Quantity (kg)"><Input type="number" min="0.1" max={listing.quantityKg} step="0.1" value={quantityKg} onChange={(event) => setQuantityKg(Number(event.target.value))} /></Field><Field label="Reward credits"><Input type="number" min="0" value={credits} onChange={(event) => setCredits(Number(event.target.value))} /></Field></div><Field label="Proposed barter terms"><textarea value={terms} onChange={(event) => setTerms(event.target.value)} className="min-h-28 w-full rounded-md border border-input bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" /></Field>{error ? <p className="text-sm text-red-700">{error}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? 'Submitting…' : 'Submit offer'}</Button></div></form></Dialog>;
}

function MatchesDialog({ listing, onClose, onOffer }: { listing: BarterListing; onClose: () => void; onOffer: (listing: BarterListing) => void }) {
  const [data, setData] = useState<{ matches: Array<{ listing: BarterListing; score: number; reasons: string[] }>; method: string } | null>(null); const [error, setError] = useState('');
  useEffect(() => { platformApi.matches(listing.id).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to calculate matches.')); }, [listing.id]);
  return <Dialog title="Compatible barter matches" subtitle={listing.title} onClose={onClose}><p className="mb-4 rounded-md bg-[#f1f4f2] p-3 text-xs leading-5 text-[#66736e]">{data?.method ?? 'Calculating transparent compatibility scores…'}</p>{error ? <p className="text-sm text-red-700">{error}</p> : null}<div className="space-y-3">{data?.matches.map((match) => <article key={match.listing.id} className="rounded-md border border-[#dfe5e2] p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-[#17201d]">{match.listing.title}</p><p className="mt-1 text-xs text-[#718079]">{match.listing.ownerName} · {match.listing.quantityKg} kg</p></div><span className="text-lg font-semibold text-emerald-700">{match.score}%</span></div><p className="mt-3 text-xs text-[#66736e]">{match.reasons.join(' · ')}</p>{match.listing.ownerId !== listing.ownerId ? <Button size="sm" variant="outline" className="mt-3" onClick={() => onOffer(match.listing)}>Open offer</Button> : null}</article>)}{data && !data.matches.length ? <EmptyBlock label="No compatible open listings currently meet the matching threshold." /> : null}</div></Dialog>;
}

function Dialog({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) { return <div className="overlay-enter fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" onMouseDown={onClose}><section className="drawer-enter max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-md bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><header className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-[#17201d]">{title}</h2><p className="mt-1 text-xs text-[#718079]">{subtitle}</p></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog"><X size={18} /></Button></header>{children}</section></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-medium text-[#53615c]">{label}</span>{children}</label>; }
function TopMetric({ label, value, detail, accent = false }: { label: string; value: number | string; detail: string; accent?: boolean }) { return <div className={cn('border-b border-[#dfe5e2] p-4 sm:border-b-0', accent && 'bg-[#edf4f1]')}><p className="text-xs text-[#66736e]">{label}</p><p className="mt-2 text-2xl font-semibold text-[#17201d]">{value}</p><p className="mt-1 text-xs text-[#718079]">{detail}</p></div>; }
function Mini({ label, value }: { label: string; value: string }) { return <div><p className="text-[10px] text-[#8b9893]">{label}</p><p className="mt-1 line-clamp-2 font-medium text-[#53615c]">{value}</p></div>; }
function statusTone(status: BarterListing['status']) { return status === 'Open' ? 'text-emerald-700' : status === 'Reserved' ? 'text-amber-700' : 'text-[#53615c]'; }
function formatDate(value: string) { return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(value)); }
