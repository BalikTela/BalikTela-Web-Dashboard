import { Archive, Clock3, PackageCheck } from 'lucide-react';
import type { HubOperationsMonitoring } from '../../shared/hubs';
import { formatMass } from '../../shared/metrics';
import { SummaryCard } from './SummaryCard';

export function HubHandlingSummary({ summary }: { summary?: HubOperationsMonitoring['summary'] }) {
  const received = !summary ? '--' : summary.batches === 0 ? formatMass(0) : formatMass(summary.collectedKg, 'Intake not recorded');
  const awaiting = !summary ? '--' : summary.awaitingDisposalKg == null
    ? summary.missingIntakeBatches > 0 ? 'Intake not recorded' : 'Balance unavailable'
    : formatMass(summary.awaitingDisposalKg);
  return <section className="stagger-grid grid gap-5 sm:grid-cols-3" aria-label="Hub intake and disposal totals">
    <SummaryCard label="Textiles Received by Hubs" value={received} detail={summary ? `${summary.collectedBatches} of ${summary.batches} batches have intake records` : 'Physical intake receipts'} icon={PackageCheck}/>
    <SummaryCard label="Recorded Hub Disposal" value={!summary ? '--' : summary.disposedKg === null ? 'Feed unavailable'
      : !summary.disposalRecords && summary.invalidDisposalRecords ? 'Records need review' : formatMass(summary.disposedKg)} detail={summary ? `${summary.disposalRecords} disposal ${summary.disposalRecords===1?'record':'records'}; separate from recycling` : 'Shared Hub disposal ledger'} icon={Archive}/>
    <SummaryCard label="Awaiting Disposal" value={awaiting} detail={summary ? `${summary.balancedBatches} of ${summary.batches} batch balances reconciled` : 'Intake minus disposal and recorded transfers out'} icon={Clock3}/>
  </section>;
}
