// THE gate. Every candidate and every Apply passes through these checks.
import type { Channel, Listing, Violation } from './types';
import type { Settings } from '../config';
import { addDays, diffDays } from './dates';

export const PRICE_EPS = 0.005;

// Number of price changes in the 6 days before `date` (so date's own change makes the 7th day).
export function changesInWindowBefore(dates: string[], date: string) {
  return new Set(dates.filter((d) => diffDays(date, d) >= 1 && diffDays(date, d) <= 6)).size;
}

export function canChangePrice(l: Listing, effectiveDate: string, s: Settings) {
  return changesInWindowBefore(l.priceChangeDates, effectiveDate) + 1 <= s.maxPriceChangesPer7d;
}

export function parityOk(amazonPrice: number, noonPrice: number, s: Settings) {
  return Math.abs(noonPrice - amazonPrice) <= s.parityBand * amazonPrice + PRICE_EPS;
}

// Noon's legal price band given an Amazon price, intersected with Noon's floor.
export function noonBand(amazonPrice: number, s: Settings) {
  return [amazonPrice * (1 - s.parityBand), amazonPrice * (1 + s.parityBand)] as const;
}

export function roundPrice(p: number, floor: number) {
  // Whole dirhams, never below the floor.
  const r = Math.round(p);
  return r + PRICE_EPS >= floor ? r : Math.ceil(floor * 100) / 100;
}

// Full audit of a world state. Used by Apply, by tests, and by the simulator.
export function checkAllRules(listings: Listing[], s: Settings): Violation[] {
  const v: Violation[] = [];
  const live = listings.filter((l) => !l.delisted);
  for (const l of live) {
    if (l.price + PRICE_EPS < l.floor) v.push({ rule: 'floor', key: l.id, detail: `${l.id} at ${l.price} below floor ${l.floor}` });
    if (l.unitsLeft < 0) v.push({ rule: 'stock', key: l.id, detail: `${l.id} has negative stock` });
    if (l.unitsLeft <= 0 && l.adSpendPerDay > 0) v.push({ rule: 'stock', key: l.id, detail: `${l.id} runs ads with no stock` });
    const dates = [...new Set(l.priceChangeDates)].sort();
    for (const d of dates) {
      const inWin = dates.filter((x) => diffDays(x, d) >= 0 && diffDays(x, d) <= 6).length;
      if (inWin > s.maxPriceChangesPer7d) {
        v.push({ rule: 'change_limit', key: l.id, detail: `${l.id} has ${inWin} changes in 7 days from ${d}` });
        break;
      }
    }
  }
  const styles = new Set(live.map((l) => l.styleId));
  for (const st of styles) {
    const a = live.find((l) => l.styleId === st && l.channel === 'amazon');
    const n = live.find((l) => l.styleId === st && l.channel === 'noon');
    if (a && n && !parityOk(a.price, n.price, s))
      v.push({ rule: 'parity', key: st, detail: `${st}: Noon ${n.price} vs Amazon ${a.price}` });
  }
  for (const ch of ['amazon', 'noon'] as Channel[]) {
    const total = live.filter((l) => l.channel === ch).reduce((a, l) => a + l.adSpendPerDay, 0);
    if (total > s.adBudget[ch] + 1e-6) v.push({ rule: 'ad_budget', key: ch, detail: `${ch} ads ${total} > ${s.adBudget[ch]}` });
  }
  return v;
}

export const effectiveDate = (today: string) => addDays(today, 1);
