import { Archive, PackageCheck } from 'lucide-react';
import type { HubOperationsMonitoring } from '../../shared/hubs';
import { formatMass } from '../../shared/metrics';
import { SummaryCard } from './SummaryCard';

export function HubHandlingSummary({ summary }: { summary?: HubOperationsMonitoring['summary'] }) {
  return <section className="stagger-grid grid gap-5 sm:grid-cols-2" aria-label="Hub submissions and disposal totals">
    <SummaryCard label="Textiles Sent to Hubs" value={!summary?'--':formatMass(summary.sentKg,'Weight unavailable')} detail={summary ? `${summary.sentBatches} consumer ${summary.sentBatches===1?'batch':'batches'} · ${summary.sentMissingWeights} missing or unresolved weights` : 'Consumer submissions, including later disposals'} icon={PackageCheck}/>
    <SummaryCard label="Recorded Hub Disposal" value={!summary ? '--' : summary.disposedKg === null ? 'Feed unavailable'
      : !summary.disposalRecords && summary.invalidDisposalRecords ? 'Records need review' : formatMass(summary.disposedKg)} detail={summary ? `${summary.disposalRecords} disposal ${summary.disposalRecords===1?'record':'records'}; separate from recycling` : 'Shared Hub disposal ledger'} icon={Archive}/>
  </section>;
}
