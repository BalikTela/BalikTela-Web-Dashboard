import { AlertCircle, Coins, PackageCheck, Scale, Waypoints } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OperationsAnalytics, Transfer, WalletEntry } from '../platformTypes';
import { platformApi } from '../services/platformApi';

export function ParticipantImpact() {
  const [operations, setOperations] = useState<OperationsAnalytics | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [wallet, setWallet] = useState<{ balance: number; entries: WalletEntry[] }>({ balance: 0, entries: [] });
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([platformApi.operationsAnalytics(), platformApi.transfers(), platformApi.wallet()])
      .then(([analytics, transferResult, walletResult]) => { setOperations(analytics); setTransfers(transferResult.transfers); setWallet(walletResult); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load circular activity.'));
  }, []);

  if (error) return <p className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!operations) return <div className="grid min-h-80 place-items-center text-sm text-[#718079]">Loading validated activity…</div>;
  return (
    <div className="space-y-5">
      <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-3"><AlertCircle size={18} className="mt-0.5 shrink-0" /><div><p className="font-medium">Environmental claims are disabled</p><p className="mt-1 text-xs leading-5 text-amber-800">This view reports material mass and validated lifecycle activity only. CO2e, water, and landfill-equivalent claims remain unavailable pending an approved methodology.</p></div></div>
      </section>

      <section className="grid overflow-hidden rounded-md border border-[#dce4e0] bg-white sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Scale} label="Material declared" value={`${operations.metrics.declaredKg.toLocaleString()} kg`} detail={`${operations.metrics.batchCount} unique batches in account scope`} />
        <Metric icon={Waypoints} label="Received material" value={`${operations.metrics.receivedKg.toLocaleString()} kg`} detail="Receipt measurements, not accepted offers" />
        <Metric icon={PackageCheck} label="Verified completion" value={`${operations.metrics.verifiedKg.toLocaleString()} kg`} detail={`${operations.metrics.completedTransfers} validated completed transfers`} />
        <Metric icon={Coins} label="Demo credit balance" value={wallet.balance.toLocaleString()} detail="Issued only after validated completion" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="surface-panel rounded-md p-5 sm:p-6">
          <p className="text-xs font-medium text-emerald-700">MASS RECONCILIATION</p><h2 className="mt-2 text-lg font-semibold">Material evidence by lifecycle stage</h2>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4"><Mass label="Declared" value={operations.massBalance.declaredKg} /><Mass label="Handed over" value={operations.massBalance.handedOverKg} /><Mass label="Received" value={operations.massBalance.receivedKg} /><Mass label="Verified" value={operations.massBalance.verifiedKg} /></div>
          <p className="mt-5 text-xs leading-5 text-[#66736e]">Operational completion rate: {operations.metrics.diversionRate}% using {operations.metrics.denominator.toLowerCase()}. This is a material-flow indicator, not an environmental impact claim.</p>
        </div>

        <div className="surface-panel rounded-md p-5 sm:p-6">
          <h2 className="text-sm font-semibold">Measurement quality</h2>
          <div className="mt-4 divide-y divide-[#e7ece9] border-y border-[#e7ece9]">
            <Status label="Estimated batches" value={operations.quality.estimatedBatches.toString()} tone="text-amber-700" />
            <Status label="Measured batches" value={operations.quality.measuredBatches.toString()} tone="text-[#34423d]" />
            <Status label="Verified batches" value={operations.quality.verifiedBatches.toString()} tone="text-emerald-700" />
            <Status label="Discrepancy flags" value={operations.quality.discrepancyFlags.toString()} tone={operations.quality.discrepancyFlags ? 'text-amber-700' : 'text-emerald-700'} />
          </div>
        </div>
      </section>

      <section className="surface-panel rounded-md p-5 sm:p-6">
        <h2 className="text-sm font-semibold">Transfer traceability</h2><p className="mt-1 text-xs text-[#718079]">Accepted proposals remain pending until handover, receipt, validation, and outcome completion are recorded.</p>
        <div className="mt-4 divide-y divide-[#e7ece9] border-y border-[#e7ece9]">{transfers.map((transfer) => <div key={transfer.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{transfer.materialCategory} · {transfer.id}</p><p className="mt-1 text-xs text-[#718079]">{transfer.events.length} lifecycle events · updated {formatDate(transfer.updatedAt)}</p></div><div className="text-left sm:text-right"><p className="text-sm font-semibold">{transfer.verifiedWeightKg ?? transfer.receiptWeightKg ?? transfer.handoverWeightKg ?? transfer.agreedWeightKg} kg</p><p className="text-xs text-[#718079]">{transfer.status}</p></div></div>)}{!transfers.length ? <p className="py-8 text-center text-sm text-[#718079]">No transfer records are associated with this account.</p> : null}</div>
      </section>

      <section className="surface-panel rounded-md p-5 sm:p-6">
        <h2 className="text-sm font-semibold">Validated reward activity</h2><p className="mt-1 text-xs text-[#718079]">Transfer-linked credits are released only after validated completion.</p>
        <div className="mt-4 divide-y divide-[#e7ece9] border-y border-[#e7ece9]">{wallet.entries.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm font-medium">{entry.description}</p><p className="mt-1 text-xs text-[#718079]">{entry.type} · {formatDate(entry.createdAt)}{entry.transferId ? ` · ${entry.transferId}` : ''}</p></div><p className={entry.credits >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold'}>{entry.credits >= 0 ? '+' : ''}{entry.credits}</p></div>)}</div>
      </section>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string; detail: string }) { return <div className="border-b border-[#dce4e0] p-5 last:border-b-0 sm:border-r sm:odd:border-r xl:border-b-0 xl:last:border-r-0"><Icon size={18} className="text-emerald-700" /><p className="mt-5 text-xs text-[#66736e]">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-[#718079]">{detail}</p></div>; }
function Mass({ label, value }: { label: string; value: number }) { return <div className="border-t border-[#dce4e0] pt-3"><p className="text-[10px] uppercase text-[#8b9893]">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value.toLocaleString()} kg</p></div>; }
function Status({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className="flex items-center justify-between gap-4 py-3 text-xs"><span className="text-[#66736e]">{label}</span><span className={`font-medium tabular-nums ${tone}`}>{value}</span></div>; }
function formatDate(value: string) { return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(value)); }
