import type { BarterListing } from '../platformTypes.js';

export const emptyListingFilters = { status: '', region: '', textileType: '', circularPathway: '', weightStatus: '', wasteSource: '', recordType: '' };
export type ListingFilters = typeof emptyListingFilters;

export function filterListings(listings: BarterListing[], query: string, filters: ListingFilters) {
  const needle = query.trim().toLowerCase();
  return listings.filter(item => Object.entries(filters).every(([field, selected]) => !selected ||
    (field === 'recordType' ? (item.isDemo ? 'Demo' : 'Operational') : item[field as keyof BarterListing]) === selected)
    && [item.id, item.batchId, item.title, item.ownerName, item.textileType, item.city, item.region].join(' ').toLowerCase().includes(needle));
}
