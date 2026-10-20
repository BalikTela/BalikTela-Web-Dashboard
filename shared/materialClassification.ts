export interface Recyclability {
  eligible: boolean;
  basis: 'Recorded classification' | 'Consumer listing assumption' | 'Not classified';
}

export function textileRecyclability(batch: { id: string; condition: string; sourceUserId: string }, context: {
  users?: Array<{ id: string; role: string }>;
  listings?: Array<{ batchId: string; ownerId: string; status: string }>;
} = {}): Recyclability {
  if (batch.condition === 'Recyclable') return { eligible: true, basis: 'Recorded classification' };
  const consumer = context.users?.some(user => user.id === batch.sourceUserId && user.role === 'Consumer');
  const posted = context.listings?.some(listing => listing.batchId === batch.id && listing.ownerId === batch.sourceUserId && !['Draft', 'Unknown'].includes(listing.status));
  return consumer && posted ? { eligible: true, basis: 'Consumer listing assumption' } : { eligible: false, basis: 'Not classified' };
}
