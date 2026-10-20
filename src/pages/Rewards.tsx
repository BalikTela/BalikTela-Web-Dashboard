import { useCallback, useEffect, useRef, useState } from 'react';
import { Award, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, RefreshCw, Trophy, UsersRound } from 'lucide-react';
import type { RewardsPage, RewardView } from '../../shared/rewards';
import { useAuth } from '../context/AuthContext';
import { useRecordRefresh } from '../hooks/useRecordRefresh';
import { platformApi } from '../services/platformApi';
import { SummaryCard } from '../components/SummaryCard';
import { Panel } from '../components/Panel';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../components/StateBlock';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/select';

const entryLabels = { earned: 'Earned', reversal: 'Reversal', adjustment: 'Adjustment', redemption: 'Redeemed' };
const number = (value: number) => value.toLocaleString('en-US');
const date = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });

export function Rewards() {
  const { access } = useAuth();
  const allowed = Boolean(access?.permissions.includes('rewards.read'));
  const [view, setView] = useState<RewardView>('leaderboard');
  const [page, setPage] = useState(1), [limit, setLimit] = useState(20);
  const key = `${view}:${page}:${limit}`;
  const [result, setResult] = useState<{ key: string; value: RewardsPage } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const version = useRef(0);
  const data = allowed && result?.key === key ? result.value : null;
  const load = useCallback(async () => {
    if (!allowed) return;
    const request = ++version.current;
    setLoading(true); setError('');
    try {
      const value = await platformApi.rewards({ view, page, limit });
      if (request === version.current) setResult({ key, value });
    } catch (cause) {
      if (request === version.current) setError(cause instanceof Error ? cause.message : 'Unable to load rewards.');
    } finally { if (request === version.current) setLoading(false); }
  }, [allowed, view, page, limit, key]);
  useEffect(() => { void load(); return () => { version.current++; }; }, [load]);
  useRecordRefresh(load, ['/users', '/listings', '/transfers']);
  if (!allowed) return <EmptyBlock label="Rewards are not available for this account." />;

  return <div className="space-y-5">
    <SectionHeader title="Consumer Rewards" eyebrow="All time · Currently active Consumer accounts" actions={
      <Button variant="outline" size="icon" title="Refresh rewards" aria-label="Refresh rewards" disabled={loading} onClick={() => void load()}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></Button>
    } />
    {data ? <div className="grid gap-5 sm:grid-cols-3">
      <SummaryCard label="Eligible Consumers" value={number(data.summary.consumers)} detail="Includes zero-point accounts" icon={UsersRound} />
      <SummaryCard label="Consumers with points" value={number(data.summary.consumersWithPoints)} detail="Accumulated points above zero" icon={Award} />
      <SummaryCard label="Accumulated points" value={number(data.summary.accumulatedPoints)} detail="Leaderboard total; not wallet balances" icon={Trophy} />
    </div> : null}
    <div className="flex gap-5 border-b border-slate-200" role="group" aria-label="Reward sections">
      {(['leaderboard', 'activity'] as const).map(tab => <button key={tab} type="button" aria-pressed={view === tab} onClick={() => { setView(tab); setPage(1); }} className={`border-b-2 px-1 py-3 text-sm font-medium ${view === tab ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>
        {tab === 'leaderboard' ? 'Leaderboard' : 'Reward Activity'}
      </button>)}
    </div>
    {error ? data ? <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Refresh failed. Showing previously loaded rewards.</p> : <ErrorBlock message={error} /> : null}
    {!data && !error ? <LoadingBlock label="Loading rewards..." /> : null}
    {data ? <Panel>
      <SectionHeader title={view === 'leaderboard' ? 'Community Leaderboard' : 'Reward Activity'} eyebrow={view === 'leaderboard' ? 'Accumulated points · Redemptions excluded' : 'Signed ledger entries · Asia/Manila'} />
      {!data.total ? <EmptyBlock label={view === 'leaderboard' ? 'No active Consumer accounts.' : 'No reward activity for active Consumers.'} /> :
        <div className="overflow-x-auto" aria-busy={loading}>
          {view === 'leaderboard' ? <table className="w-full min-w-[480px] text-left text-sm" aria-label="Community leaderboard">
            <thead><tr className="border-b border-slate-200 text-xs text-[#718079]"><th className="w-20 py-3 font-medium">Rank</th><th className="py-3 font-medium">Consumer</th><th className="py-3 text-right font-medium">Accumulated points</th></tr></thead>
            <tbody>{data.leaderboard.map(member => <tr key={member.id} className="border-b border-slate-100 last:border-0 hover:bg-[#f7f9f8]">
              <td className="py-4 align-top font-semibold tabular-nums text-[#1d604b]">{number(member.rank)}</td>
              <td className="px-2 py-4"><p className="break-words font-medium text-[#34423d]">{member.name}</p><p className="mt-1 break-all text-xs text-[#718079]">{member.id}</p></td>
              <td className="py-4 text-right align-top font-semibold tabular-nums text-[#1d604b]">{number(member.points)}</td>
            </tr>)}</tbody>
          </table> : <table className="w-full min-w-[720px] table-fixed text-left text-sm" aria-label="Reward activity">
            <thead><tr className="border-b border-slate-200 text-xs text-[#718079]"><th className="w-[22%] py-3 font-medium">Consumer</th><th className="w-[36%] px-3 py-3 font-medium">Activity</th><th className="w-[13%] py-3 font-medium">Type</th><th className="w-[10%] px-2 py-3 text-right font-medium">Points</th><th className="w-[19%] py-3 pl-4 font-medium">Recorded</th></tr></thead>
            <tbody>{data.activity.map(entry => <tr key={entry.id} className="border-b border-slate-100 last:border-0 hover:bg-[#f7f9f8]">
              <td className="break-words py-4 align-top font-medium text-[#34423d]">{entry.name}<p className="mt-1 break-all text-xs font-normal text-[#718079]">{entry.userId}</p></td>
              <td className="break-words px-3 py-4 align-top text-[#53615c]">{entry.title}<p className="mt-1 break-all text-xs text-[#718079]">{entry.id}</p></td>
              <td className="py-4 align-top text-xs text-[#53615c]">{entryLabels[entry.entryType]}</td>
              <td className={`px-2 py-4 text-right align-top font-semibold tabular-nums ${entry.points < 0 ? 'text-amber-800' : 'text-[#1d604b]'}`}>{entry.points > 0 ? '+' : ''}{number(entry.points)}</td>
              <td className="py-4 pl-4 align-top text-xs leading-5 text-[#718079]">{date.format(new Date(entry.createdAt))}</td>
            </tr>)}</tbody>
          </table>}
        </div>}
      <nav aria-label="Rewards pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#dfe5e2] pt-4 text-xs text-[#66736e]">
        <p role="status" className="tabular-nums">{data.total ? (data.page - 1) * data.limit + 1 : 0}-{Math.min(data.page * data.limit, data.total)} of {number(data.total)} records</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">Rows per page<Select aria-label="Rewards rows per page" className="w-20" value={limit} disabled={loading} onChange={event => { setLimit(Number(event.target.value)); setPage(1); }}>{[10, 20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</Select></label>
          <span>Page {data.page} of {data.pages}</span>
          <div className="flex gap-1">{[
            { name: 'First page', page: 1, icon: ChevronFirst, disabled: data.page === 1 },
            { name: 'Previous page', page: data.page - 1, icon: ChevronLeft, disabled: data.page === 1 },
            { name: 'Next page', page: data.page + 1, icon: ChevronRight, disabled: data.page === data.pages },
            { name: 'Last page', page: data.pages, icon: ChevronLast, disabled: data.page === data.pages },
          ].map(action => <Button key={action.name} type="button" variant="outline" size="icon" title={action.name} aria-label={action.name} disabled={loading || action.disabled} onClick={() => setPage(action.page)}><action.icon size={15} /></Button>)}</div>
        </div>
      </nav>
    </Panel> : null}
  </div>;
}
