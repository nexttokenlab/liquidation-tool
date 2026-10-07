import type { Estimate } from './types';

export type ScoreInput = {
  price: number;
  adPerDay: number;
  stock: number; // S
  daysLeft: number; // D
  unitCost: number;
  holdingPerUnitPerDay: number;
  jobberRate: number;
  feeRate: number;
};

// Predicted units/day at a given price and ad level.
export function predictPace(est: Pick<Estimate, 'basePace' | 'p0' | 'elasticity' | 'conversion' | 'cpc' | 'adMultiplier'>, price: number, adPerDay: number) {
  const organic = est.basePace * Math.pow(price / est.p0, est.elasticity);
  const ads = est.cpc > 0 ? (adPerDay / est.cpc) * est.conversion * est.adMultiplier : 0;
  return { pace: Math.max(0, organic + ads), organic, adUnits: ads };
}

// Money recovered by the deadline for one listing:
//   online revenue - ad spend while stock lasts - holding cost + jobber value of leftovers.
export function moneyRecovered(pace: number, x: ScoreInput) {
  const { price, adPerDay, stock: S, daysLeft: D } = x;
  const q = Math.min(S, pace * D); // units sold online
  const t = pace > 0 ? Math.min(D, S / pace) : D; // days until stock runs out
  const adCost = S > 0 ? adPerDay * t : 0;
  // Stock falls linearly for t days, then stays at S - q until the deadline.
  const holding = x.holdingPerUnitPerDay * (((S + (S - pace * t)) / 2) * t + (S - q) * (D - t));
  const leftover = S - q;
  const revenue = price * (1 - x.feeRate) * q;
  const jobber = x.jobberRate * x.unitCost * leftover;
  return { value: revenue - adCost - holding + jobber, sold: q, leftover, revenue, adCost, holding, jobber };
}

export const jobberNowValue = (stock: number, unitCost: number, jobberRate: number) => jobberRate * unitCost * stock;
