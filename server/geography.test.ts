import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { geographicValue, markerDiameter, rankedRegions } from '../src/lib/geography.js';
import type { RegionActivity } from '../src/types.js';

const region = (name: RegionActivity['region'], collectionKg: number): RegionActivity => ({ region: name, collectionKg, recyclingKg: 0, wasteGapKg: collectionKg / 2, city: 'Synthetic reference', producers: 1, collectionPoints: 1, recyclers: 1, x: 0, y: 0 });

test('geographic ranking follows the active metric without mutating source data', () => {
  const source = [region('Metro Manila', 1000), region('Central Visayas', 2000)];
  source[0].recyclingKg = 800;
  assert.equal(rankedRegions(source, 'collectionKg')[0].region, 'Central Visayas');
  assert.equal(rankedRegions(source, 'recyclingKg')[0].region, 'Metro Manila');
  assert.equal(source[0].region, 'Metro Manila');
});

test('geographic symbols handle zero and invalid activity and preserve relative scale', () => {
  assert.equal(geographicValue(region('Metro Manila', Number.NaN), 'collectionKg'), 0);
  assert.equal(geographicValue(region('Metro Manila', -1), 'collectionKg'), 0);
  assert.equal(markerDiameter(0, 0), 14);
  assert.ok(markerDiameter(100, 100) > markerDiameter(25, 100));
  assert.equal(markerDiameter(100, 100), markerDiameter(1000, 1000));
});

test('bundled map data includes Philippine polygons and valid indicative city anchors', async () => {
  const map = JSON.parse(await readFile(new URL('../src/assets/maps/philippines-context.geo.json', import.meta.url), 'utf8'));
  const locations = JSON.parse(await readFile(new URL('../src/assets/maps/regional-anchors.json', import.meta.url), 'utf8'));
  assert.ok(map.features.some((feature: {properties: {code: string}}) => feature.properties.code === 'PHL'));
  assert.equal(map.revision, locations.revision);
  assert.equal(Object.keys(locations.anchors).length, 4);
  for (const anchor of Object.values(locations.anchors) as Array<{latitude: number; longitude: number}>) {
    assert.ok(Number.isFinite(anchor.latitude) && anchor.latitude > 4 && anchor.latitude < 22);
    assert.ok(Number.isFinite(anchor.longitude) && anchor.longitude > 116 && anchor.longitude < 128);
  }
});
