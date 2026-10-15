import { mkdir, writeFile } from 'node:fs/promises';

const repository = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector';
const commitResponse = await fetch('https://api.github.com/repos/nvkelso/natural-earth-vector/commits/master');
if (!commitResponse.ok) throw new Error(`Unable to resolve map data revision: ${commitResponse.status}`);
const { sha } = await commitResponse.json();
async function source(file) {
  const response = await fetch(`${repository}/${sha}/geojson/${file}`);
  if (!response.ok) throw new Error(`Unable to download ${file}: ${response.status}`);
  return response.json();
}
const countries = await source('ne_50m_admin_0_countries.geojson');
const places = await source('ne_10m_populated_places.geojson');
const included = new Set(['PHL', 'MYS', 'IDN', 'TWN', 'VNM', 'BRN', 'CHN']);
const features = countries.features.filter(feature => included.has(feature.properties.ADM0_A3)).map(feature => ({
  type: 'Feature', properties: { code: feature.properties.ADM0_A3, name: feature.properties.NAME_EN || feature.properties.NAME }, geometry: feature.geometry,
}));
if (!features.some(feature => feature.properties.code === 'PHL')) throw new Error('Philippines geometry is missing.');
const names = { 'Metro Manila': 'Manila', 'Central Visayas': 'Cebu', 'Western Visayas': 'Iloilo', 'Davao Region': 'Davao' };
const anchors = {};
for (const [region, city] of Object.entries(names)) {
  const place = places.features.find(feature => feature.properties.ADM0_A3 === 'PHL' && [feature.properties.NAME, feature.properties.NAME_EN, feature.properties.NAMEASCII].includes(city));
  if (!place) throw new Error(`Missing reference location: ${city}`);
  anchors[region] = { city, latitude: place.geometry.coordinates[1], longitude: place.geometry.coordinates[0] };
}
await mkdir(new URL('../src/assets/maps/', import.meta.url), { recursive: true });
const map = { type: 'FeatureCollection', source: 'Natural Earth, public domain', revision: sha, features };
await writeFile(new URL('../src/assets/maps/philippines-context.geo.json', import.meta.url), JSON.stringify(map));
await writeFile(new URL('../src/assets/maps/regional-anchors.json', import.meta.url), JSON.stringify({ source: 'Natural Earth populated places; indicative regional reference locations, not participant addresses', revision: sha, anchors }, null, 2) + '\n');
console.log(JSON.stringify({ revision: sha, countries: features.map(feature => feature.properties.name), bytes: JSON.stringify(map).length, anchors }, null, 2));
