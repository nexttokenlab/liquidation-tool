// All settings in one place. Business rules come from the Opptra brief and are fixed.
// Model settings are defaults that only fill gaps; every decision-affecting magnitude
// (pace, conversion, cost per click) is computed per listing from the data.

export type Settings = typeof DEFAULT_SETTINGS;

export const DEFAULT_SETTINGS = {
  // --- Business rules (brief) ---
  horizonDays: 60,
  adBudget: { amazon: 1500, noon: 1000 } as Record<'amazon' | 'noon', number>, // AED/day, channel total
  maxPriceChangesPer7d: 2,
  parityBand: 0.05, // Noon within ±5% of Amazon, same style
  holdingPerUnitPerDay: 3 / 30, // AED 3 per unit per month
  jobberRate: 0.25, // of unit cost

  // --- Not in the brief; editable, default zero ---
  feeRate: 0,

  // --- Model choices ---
  recentWindow: 7, // days used for pace and conversion
  priorElasticity: -2.0, // % pace change per % price change, before any data
  elasticityBounds: [-5, -0.3] as [number, number],
  learningRate: 0.3, // own listing
  pooledLearningRate: 0.1, // channel-level prior
  priceSteps: [-0.05, -0.1, -0.2], // relative to current price
  smallStepLimit: -0.1, // max cut while price sensitivity is unproven
  adSteps: [0, 20, 50, 100, 150], // AED/day per listing
  maxAdPerListing: 150,
  statusBand: 0.1, // ±10% of needed pace = on track
};
