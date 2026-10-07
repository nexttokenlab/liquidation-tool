// Runs when a new day's data arrives, BEFORE any re-scoring:
// compare yesterday's predictions with what actually sold, nudge estimates partway, then re-estimate.
import type { DayRow, Prediction, State } from './types';
import { buildEstimates } from './estimate';

export type Learned = Prediction & { change: string };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function ingestDays(state: State, rows: DayRow[]): { state: State; learned: Learned[]; warnings: string[] } {
  const s = state.settings;
  const warnings: string[] = [];
  const fresh = rows.filter((r) => r.date > state.today);
  if (fresh.length < rows.length) warnings.push(`${rows.length - fresh.length} rows were on or before ${state.today} and were ignored.`);
  const dates = [...new Set(fresh.map((r) => r.date))].sort();
  const listings = state.listings.map((l) => ({ ...l, priceChangeDates: [...l.priceChangeDates] }));
  const estimates = Object.fromEntries(Object.entries(state.estimates).map(([k, v]) => [k, { ...v }]));
  const pooled = { ...state.pooledElasticity };
  const predictions = state.predictions.map((p) => ({ ...p }));
  const history = [...state.history];
  const learned: Learned[] = [];
  let today = state.today;

  for (const d of dates) {
    for (const r of fresh.filter((x) => x.date === d)) {
      const l = listings.find((x) => x.id === r.listingId);
      if (!l) { warnings.push(`Unknown listing ${r.listingId} on ${d}; ignored.`); continue; }
      if (l.delisted) { if (r.unitsSold > 0) warnings.push(`${l.id} was exited to the jobber but shows sales on ${d}; ignored.`); continue; }
      if (Math.abs(r.price - l.price) > 0.005) {
        if (!l.priceChangeDates.includes(d)) l.priceChangeDates.push(d);
        l.price = r.price;
      }
      l.adSpendPerDay = r.adSpend;
      if (r.unitsSold > l.unitsLeft) warnings.push(`${l.id} sold ${r.unitsSold} on ${d} but only ${l.unitsLeft} were left.`);
      l.unitsLeft = Math.max(0, l.unitsLeft - r.unitsSold);
      if (l.unitsLeft === 0) l.adSpendPerDay = 0;
      history.push(r);

      for (const p of predictions.filter((x) => x.forDate === d && x.listingId === l.id && x.actualUnits === undefined)) {
        p.actualUnits = r.unitsSold;
        const e = estimates[l.id];
        const parts: string[] = [];
        const organicPred = p.predictedUnits - p.adUnits;
        // Price sensitivity: what elasticity would have predicted today's sales exactly?
        if (Math.abs(p.toPrice - p.fromPrice) > 0.005 && p.basePace > 0) {
          const organicActual = Math.max(0.05, r.unitsSold - p.adUnits);
          const implied = clamp(Math.log(organicActual / p.basePace) / Math.log(p.toPrice / p.fromPrice), ...s.elasticityBounds);
          // A small price move carries little signal in one day of sales, so it teaches less.
          const weight = Math.min(1, Math.abs(Math.log(p.toPrice / p.fromPrice)) / 0.2);
          const old = e.elasticity;
          e.elasticity = clamp(old + s.learningRate * weight * (implied - old), ...s.elasticityBounds);
          e.elasticitySource = 'own';
          pooled[l.channel] = pooled[l.channel] + s.pooledLearningRate * weight * (implied - pooled[l.channel]);
          parts.push(`price response ${old.toFixed(2)} → ${e.elasticity.toFixed(2)}`);
        }
        // Ad lift: scale the multiplier toward what the ads actually delivered.
        if (p.adUnits > 0.01) {
          const raw = p.adUnits / Math.max(e.adMultiplier, 1e-6);
          const implied = clamp(Math.max(0, r.unitsSold - organicPred) / raw, 0, 3);
          const old = e.adMultiplier;
          e.adMultiplier = clamp(old + s.learningRate * (implied - old), 0, 3);
          parts.push(`ad lift ×${old.toFixed(2)} → ×${e.adMultiplier.toFixed(2)}`);
        }
        learned.push({ ...p, change: parts.length ? parts.join(', ') : 'logged' });
      }
    }
    const missing = listings.filter((l) => !l.delisted && !fresh.some((r) => r.date === d && r.listingId === l.id));
    if (missing.length) warnings.push(`${missing.length} listings had no row for ${d}; treated as no sales.`);
    today = d;
  }

  const rebuilt = buildEstimates(listings, history, s, estimates, pooled);
  return {
    state: { ...state, today, listings, history, estimates: rebuilt.estimates, pooledElasticity: rebuilt.pooled, predictions, applied: dates.length ? {} : state.applied },
    learned,
    warnings,
  };
}
