export const LISTING_STATUSES = { draft: 'Draft', available: 'Open', matched: 'Matched', reserved: 'Reserved', completed: 'Completed', closed: 'Closed', archived: 'Archived' } as const;
export const OFFER_STATUSES = { pending: 'Pending', revised: 'Revised', accepted: 'Accepted', rejected: 'Declined', withdrawn: 'Withdrawn', cancelled: 'Cancelled', expired: 'Expired', closed: 'Closed' } as const;
export const TRANSFER_STATUSES = { reserved: 'Reserved', accepted: 'Accepted', in_progress: 'In progress', handed_over: 'Handed over', collected: 'Collected', received: 'Received', processing: 'Processing', validated: 'Validated', completed: 'Completed', processed: 'Processed', cancelled: 'Cancelled', rejected: 'Rejected', disputed: 'Disputed', expired: 'Expired', closed: 'Closed' } as const;
export const BATCH_STATUSES = { recorded: 'Recorded', draft: 'Draft', listed: 'Listed', reserved: 'Reserved', in_transit: 'In transit', collected: 'Collected', received: 'Received', validated: 'Validated', processing: 'Processing', reused: 'Reused', upcycled: 'Upcycled', recycled: 'Recycled', recovered: 'Recovered', rejected: 'Rejected', closed: 'Closed', archived: 'Archived' } as const;
export type BatchStatus = typeof BATCH_STATUSES[keyof typeof BATCH_STATUSES] | 'Unknown';
export type ListingStatus = typeof LISTING_STATUSES[keyof typeof LISTING_STATUSES] | 'Unknown';
export type OfferStatus = typeof OFFER_STATUSES[keyof typeof OFFER_STATUSES] | 'Unknown';
export type TransferStatus = typeof TRANSFER_STATUSES[keyof typeof TRANSFER_STATUSES] | 'Unknown';
export const MATERIAL_CATEGORIES = ['Cotton', 'Polyester', 'Denim', 'Mixed fabric', 'Uniforms', 'Household linen', 'Linen', 'Canvas', 'Twill', 'Other fabric'] as const;
export const MATERIAL_CONDITIONS = ['New', 'Like new', 'Excellent', 'Good', 'Well loved', 'Reusable', 'Repairable', 'Recyclable', 'For assessment'] as const;
export const CIRCULAR_PATHWAYS = ['Collection', 'Reuse', 'Repair', 'Redistribution', 'Upcycling', 'Recycling', 'Recovery', 'Diversion', 'For assessment'] as const;

export function canonicalStatus(status: string, original: string | undefined, labels: Record<string, string>) {
  if (original && (labels[original] ?? 'Unknown') === status) return original;
  const value = Object.keys(labels).find(key => labels[key] === status);
  if (!value) throw new Error(`Unsupported workflow status: ${status}`);
  return value;
}

export const isCompletedTransfer = (status: string) => ['Completed', 'Processed'].includes(status);
export const isTerminalTransfer = (status: string) => isCompletedTransfer(status) || ['Cancelled', 'Rejected', 'Expired', 'Closed', 'Unknown'].includes(status);
export function matchesTransferStatus(status: string, selected: unknown) {
  if (!selected || selected === 'All statuses') return true;
  if (selected === 'Completed') return isCompletedTransfer(status);
  if (selected === 'Flagged') return ['Disputed', 'Rejected'].includes(status);
  if (selected === 'In transit') return ['Handed over', 'Collected', 'In progress'].includes(status);
  if (selected === 'In sorting') return ['Received', 'Processing'].includes(status);
  if (selected === 'Pending validation') return ['Reserved', 'Accepted'].includes(status);
  return selected === status;
}

export const LISTING_DISPLAY_STATUSES = ['Draft', 'Available', 'In progress', 'Completed', 'Closed', 'Unknown'] as const;
export const LISTING_HANDLING_STATUSES = ['Disposed', 'Partially disposed', 'Remainder pending', 'None'] as const;
type ListingState = { status: string; canonicalStatus?: string; disposedAt?: string | null; disposedWeightKg?: number; remainderPending?: boolean };

export function listingWorkflowStatus(listing: ListingState) {
  if (listing.canonicalStatus !== undefined) return Object.prototype.hasOwnProperty.call(LISTING_STATUSES, listing.canonicalStatus) ? listing.canonicalStatus : undefined;
  return Object.keys(LISTING_STATUSES).find(key => LISTING_STATUSES[key as keyof typeof LISTING_STATUSES] === listing.status);
}

export function listingDisplayStatus(listing: ListingState) {
  // Match mobile My textiles categories; disposal and remainder handling are separate facts.
  switch (listingWorkflowStatus(listing)) {
    case 'draft': return 'Draft';
    case 'available': return 'Available';
    case 'matched': case 'reserved': return 'In progress';
    case 'completed': return 'Completed';
    case 'closed': case 'archived': return 'Closed';
    default: return 'Unknown';
  }
}

export function listingHandlingStatus(listing: ListingState) {
  if (listing.disposedAt) return 'Disposed';
  if (listing.remainderPending) return 'Remainder pending';
  if ((listing.disposedWeightKg ?? 0) > 0) return 'Partially disposed';
  return 'None';
}
export function canModerateListing(listing: Parameters<typeof listingDisplayStatus>[0] & { reservedKg?: number }) {
  const workflow = listingWorkflowStatus(listing);
  return !listing.disposedAt && !(listing.disposedWeightKg ?? 0) && !listing.remainderPending && !(listing.reservedKg ?? 0)
    && workflow !== undefined && LISTING_STATUSES[workflow as keyof typeof LISTING_STATUSES] === listing.status
    && ['Open', 'Matched', 'Closed', 'Draft', 'Archived'].includes(listing.status);
}
export function availableStockKg(listing: { quantityKg: number | null; availableWeightKg?: number | null; reservedKg?: number }) {
  const stock = listing.availableWeightKg === undefined ? listing.quantityKg : listing.availableWeightKg;
  return stock === null ? null : Math.max(0, stock - (listing.reservedKg ?? 0));
}
