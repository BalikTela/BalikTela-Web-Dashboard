export type ForecastMethod = 'last-value' | 'trailing-mean' | 'linear-trend' | 'seasonal-naive';
export const FORECAST_METHOD_LABELS: Record<ForecastMethod, string> = {
  'last-value': 'Last observed week', 'trailing-mean': 'Trailing 8-week mean',
  'linear-trend': 'Trailing 26-week linear trend', 'seasonal-naive': 'Seasonal naive (52 weeks)',
};
export type DatasetPartition = 'training' | 'validation' | 'test';

export interface TrainingObservation {
  id: string;
  weekStart: string;
  occurredAt: string;
  collectionAt: string;
  selectionAt: string;
  region: string;
  materialCategory: string;
  recyclerId: string;
  declaredKg: number;
  collectedKg: number;
  recyclerSelected: boolean;
  partition: DatasetPartition;
  isSynthetic: true;
}

export interface TrainingManifest {
  version: string;
  seed: number;
  sha256: string;
  recordCount: number;
  weeklyObservations: number;
  periodStart: string;
  cutoffExclusive: string;
  partitions: Array<{ name: DatasetPartition; records: number; weeks: number; start: string; endExclusive: string }>;
  disclosure: string;
}

export interface ForecastEvaluation {
  maeKg: number;
  wapePercent: number | null;
  biasKg: number;
  predictions: number;
  intervalCoveragePercent: number | null;
}

export interface WeeklyForecastPoint {
  weekStart: string;
  declaredKg: number;
  collectedKg: number;
  declaredLowerKg: number;
  declaredUpperKg: number;
  collectedLowerKg: number;
  collectedUpperKg: number;
}

export interface MaterialTendency {
  materialCategory: string;
  offers: number;
  selected: number;
  selectionProbability: number;
  observedSelectedSharePercent: number;
  changePoints: number | null;
  weeklyRates: Array<number | null>;
}

export interface PredictiveReport {
  mode: 'synthetic-poc';
  status: 'ready' | 'insufficient-data';
  message: string;
  manifest: TrainingManifest;
  scope: { region: string; materialCategory: string; records: number; activeWeeks: number };
  regions: string[];
  materials: string[];
  history: Array<{ weekStart: string; declaredKg: number; collectedKg: number }>;
  forecast: WeeklyForecastPoint[];
  totals: { declaredKg: number; collectedKg: number };
  models: {
    declared: { method: ForecastMethod; validation: ForecastEvaluation; test: ForecastEvaluation };
    collected: { method: ForecastMethod; validation: ForecastEvaluation; test: ForecastEvaluation };
  } | null;
  preferences: {
    windowWeeks: number;
    testBrierScore: number;
    baselineBrierScore: number;
    testLogLoss: number;
    testOffers: number;
    ranked: MaterialTendency[];
  } | null;
  limitations: string[];
}
