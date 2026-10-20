import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeRecord, encodeRecord } from './database/codecs.js';
import { createSeedData } from './seed.js';
import { canModerateListing, listingDisplayStatus, listingHandlingStatus, LISTING_STATUSES } from '../shared/workflows.js';
import { emptyListingFilters, filterListings } from '../src/lib/listingFilters.js';

// Contract from mobile src/lib/domain.ts:textileCategory and components/textiles.tsx.
const mobileCategories = { draft: 'Draft', available: 'Available', matched: 'In progress', reserved: 'In progress',
  completed: 'Completed', closed: 'Closed', archived: 'Closed' } as const;

test('listing badges and filters match mobile inventory categories without changing stored workflow states', async () => {
  const base = (await createSeedData()).listings[0];
  for (const [state, category] of Object.entries(mobileCategories)) {
    const record = decodeRecord('listings', { ...encodeRecord('listings', base), status: state });
    assert.equal(listingDisplayStatus(record), category, state);
    assert.equal(filterListings([record], '', { ...emptyListingFilters, status: category }).length, 1);
    assert.equal(encodeRecord('listings', record).status, state);
    const { canonicalStatus: _, ...legacy } = record;
    assert.equal(listingDisplayStatus(legacy), category, 'Memory fixtures retain the same category');
  }
});

test('mobile source state is authoritative and unknown states do not masquerade as available or closed', () => {
  assert.equal(listingDisplayStatus({ status: 'Open', canonicalStatus: 'reserved' }), 'In progress');
  for (const canonicalStatus of ['future_mobile_status', '', 'constructor', 'toString']) {
    const record = { status: 'Open', canonicalStatus };
    assert.equal(listingDisplayStatus(record), 'Unknown');
    assert.equal(canModerateListing(record), false);
  }
  assert.equal(canModerateListing({ status: 'Open', canonicalStatus: 'reserved' }), false);
  assert.equal(canModerateListing({ status: 'Unknown' }), false);
  assert.equal(canModerateListing({ status: 'Open', canonicalStatus: 'available' }), true);
});

test('disposal and remainder handling never override listing state or infer a completed transfer', async () => {
  const base = (await createSeedData()).listings[0];
  const records = [
    { ...base, id: 'PARTIAL', canonicalStatus: 'available', disposedWeightKg: 2 },
    { ...base, id: 'DISPOSED', status: 'Archived' as const, canonicalStatus: 'archived', disposedWeightKg: 10, disposedAt: '2026-10-19T01:00:00Z' },
    { ...base, id: 'REMAINDER', status: 'Draft' as const, canonicalStatus: 'draft', remainderPending: true },
    { ...base, id: 'RESERVED', status: 'Reserved' as const, canonicalStatus: 'reserved', reservedKg: 10 },
  ];
  assert.deepEqual(records.map(listingDisplayStatus), ['Available', 'Closed', 'Draft', 'In progress']);
  assert.deepEqual(records.map(listingHandlingStatus), ['Partially disposed', 'Disposed', 'Remainder pending', 'None']);
  for (const record of records) assert.equal(canModerateListing(record), false);
  assert.deepEqual(filterListings(records, '', { ...emptyListingFilters, status: 'Available', handlingStatus: 'Partially disposed' }).map(item => item.id), ['PARTIAL']);
  assert.equal(filterListings(records, '', { ...emptyListingFilters, status: 'Completed' }).length, 0);
  assert.equal(filterListings(records, '', { ...emptyListingFilters, status: 'Closed', handlingStatus: 'Disposed' }).length, 1);
  assert.equal(filterListings(records, '', { ...emptyListingFilters, status: 'In progress', handlingStatus: 'None' }).length, 1);
});

test('reading refreshed source state changes the displayed category without deriving status from zero stock', async () => {
  const base = (await createSeedData()).listings[0];
  for (const [state, category] of Object.entries(mobileCategories)) {
    const record = { ...base, canonicalStatus: state, status: LISTING_STATUSES[state as keyof typeof LISTING_STATUSES], availableWeightKg: 0 };
    assert.equal(listingDisplayStatus(record), category);
  }
});
