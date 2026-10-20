export interface RecoveryWeights {
  inputWeightKg: number | null;
  outputWeightKg: number | null;
  residualWeightKg: number | null;
  lossWeightKg?: number | null;
}

// The same one-gram tolerance applies to entry, validation and final-output analytics.
export function recoveryMassBalance(record: RecoveryWeights): 'Balanced' | 'Incomplete' | 'Unbalanced' {
  const weights = [record.inputWeightKg, record.outputWeightKg, record.residualWeightKg, record.lossWeightKg ?? 0];
  if (weights.some(value => value == null || !Number.isFinite(value))) return 'Incomplete';
  const [input, output, rejects, loss] = weights as number[];
  if (input <= 0 || output < 0 || rejects < 0 || loss < 0) return 'Unbalanced';
  return Math.abs(input - output - rejects - loss) <= 0.001 ? 'Balanced' : 'Unbalanced';
}
