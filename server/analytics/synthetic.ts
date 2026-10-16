import { createHash } from 'node:crypto';
import type { TrainingManifest, TrainingObservation } from '../../shared/predictive.js';

export const DATASET_VERSION = 'baliktela-synthetic-predictive-v1';
export const DATASET_SEED = 20261016;
export const WEEK_MS = 7 * 86400000;
export const DATASET_WEEKS = 120;
export const TRAIN_WEEKS = 84;
export const VALIDATION_WEEKS = 18;
export const CUTOFF_EXCLUSIVE = '2026-10-12T00:00:00.000Z';
export const REGIONS = ['Metro Manila', 'Central Visayas', 'Western Visayas', 'Davao Region'];
export const MATERIALS = ['Cotton', 'Polyester', 'Denim', 'Mixed fabric', 'Uniforms', 'Household linen'];

const start = Date.parse(CUTOFF_EXCLUSIVE) - DATASET_WEEKS * WEEK_MS;
export const weekDate = (index: number) => new Date(start + index * WEEK_MS).toISOString().slice(0, 10);
const round = (value: number) => Math.round(value * 100) / 100;

export function generateSyntheticDataset(seed = DATASET_SEED): { manifest: TrainingManifest; observations: TrainingObservation[] } {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const observations: TrainingObservation[] = [];
  const materialMass = [170, 140, 280, 120, 240, 210];
  const baseSelection = [0.8, 0.47, 0.68, 0.34, 0.63, 0.59];
  const regionScale = [1.7, 1, 0.8, 0.9];

  for (let week = 0; week < DATASET_WEEKS; week++) {
    const seasonal = 1 + 0.14 * Math.sin(week * Math.PI * 2 / 52) + 0.07 * Math.cos(week * Math.PI * 2 / 26);
    for (let region = 0; region < REGIONS.length; region++) {
      const weeklyShock = 0.94 + random() * 0.12;
      for (let index = 0; index < 20; index++) {
        const material = index < 6 ? index : Math.floor(random() * MATERIALS.length);
        const occurred = start + week * WEEK_MS + (index % 5) * 86400000 + (8 + index % 7) * 3600000;
        const declaredKg = round(materialMass[material] * regionScale[region] * seasonal * (1 + week * 0.0026) * weeklyShock * (0.68 + random() * 0.64));
        const collectionRate = Math.min(0.95, Math.max(0.35, 0.61 + week * 0.0011 + region * 0.015 + (random() - 0.5) * 0.18));
        const probability = Math.min(0.95, Math.max(0.08, baseSelection[material] + 0.065 * Math.sin(week / 8 + region) + (material === 2 ? week * 0.0009 : material === 3 ? -week * 0.0004 : 0)));
        observations.push({
          id: `SYN-PRED-${String(week + 1).padStart(3, '0')}-${region + 1}-${String(index + 1).padStart(2, '0')}`,
          weekStart: weekDate(week), occurredAt: new Date(occurred).toISOString(),
          collectionAt: new Date(occurred + 86400000).toISOString(), selectionAt: new Date(occurred + 2 * 86400000).toISOString(),
          region: REGIONS[region], materialCategory: MATERIALS[material], recyclerId: `SYN-RECYCLER-${region + 1}-${index % 4 + 1}`,
          declaredKg, collectedKg: round(declaredKg * collectionRate), recyclerSelected: random() < probability,
          partition: week < TRAIN_WEEKS ? 'training' : week < TRAIN_WEEKS + VALIDATION_WEEKS ? 'validation' : 'test', isSynthetic: true,
        });
      }
    }
  }
  const manifest: TrainingManifest = {
    version: DATASET_VERSION, seed, sha256: createHash('sha256').update(JSON.stringify(observations)).digest('hex'),
    recordCount: observations.length, weeklyObservations: DATASET_WEEKS, periodStart: weekDate(0), cutoffExclusive: CUTOFF_EXCLUSIVE,
    partitions: [
      { name: 'training', records: TRAIN_WEEKS * 80, weeks: TRAIN_WEEKS, start: weekDate(0), endExclusive: weekDate(TRAIN_WEEKS) },
      { name: 'validation', records: VALIDATION_WEEKS * 80, weeks: VALIDATION_WEEKS, start: weekDate(TRAIN_WEEKS), endExclusive: weekDate(TRAIN_WEEKS + VALIDATION_WEEKS) },
      { name: 'test', records: (DATASET_WEEKS - TRAIN_WEEKS - VALIDATION_WEEKS) * 80, weeks: DATASET_WEEKS - TRAIN_WEEKS - VALIDATION_WEEKS, start: weekDate(TRAIN_WEEKS + VALIDATION_WEEKS), endExclusive: weekDate(DATASET_WEEKS) },
    ],
    disclosure: 'Entirely synthetic proof-of-concept observations. No real participant identities, operational measurements, or validated real-world accuracy claims.',
  };
  return { manifest, observations };
}

export const syntheticDataset = generateSyntheticDataset();
