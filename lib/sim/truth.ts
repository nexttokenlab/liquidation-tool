// A hidden "true market" used to (a) generate sample CSVs and (b) simulate tomorrow in demo mode.
// The engine never reads these parameters; it only sees the CSV rows they produce.
import type { Channel, DayRow, State } from '../engine/types';
import type { ConstraintRow, HistoryRow, InventoryRow } from '../engine/build';
import { listingId } from '../engine/build';
import { addDays } from '../engine/dates';
import { between, pick, poisson, rng } from './random';

export type Archetype = 'healthy' | 'hidden_demand' | 'invisible' | 'dog';
export type Truth = {
  listingId: string; archetype: Archetype; pRef: number; base: number; eps: number;
  organicSessions: number; adConv: number; cpc: number;
};
export type World = {
  inventory: InventoryRow[]; constraints: ConstraintRow[]; history: HistoryRow[]; truth: Truth[]; today: string;
};

const NAMES = ['Aero Runner', 'Court Classic', 'Dune Trail', 'Metro Knit', 'Pulse Lite', 'Harbor Low', 'Summit Hi', 'Glide 2',
  'Canvas Club', 'Strata Max', 'Nova Slip', 'Rally Mid', 'Tempo Flex', 'Coast Suede', 'Vector Pro', 'Oasis Mesh',
  'Pace Daily', 'Ridge Hiker', 'Loop Street', 'Falcon Lux'];
const SIZES = ['40', '41', '42', '43', '44', '45'];

export function expectedUnits(t: Truth, price: number, adSpend: number) {
  const clicks = t.cpc > 0 ? adSpend / t.cpc : 0;
  return { mean: t.base * Math.pow(price / t.pRef, t.eps) + clicks * t.adConv, clicks };
}

// Scale counts so they add up to exactly `total` (largest-remainder rounding).
function scaleToTotal(xs: number[], total: number) {
  const sum = xs.reduce((a, b) => a + b, 0);
  const raw = xs.map((x) => (x * total) / sum);
  const out = raw.map(Math.floor);
  const left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < left; k++) out[order[k][1]]++;
  return out;
}

export function generateWorld(
  seed: number,
  opts: { styles?: number; days?: number; endDate?: string; floorBelowJobber?: boolean; unitsToday?: number } = {},
): World {
  const r = rng(seed);
  const nStyles = opts.styles ?? 20, days = opts.days ?? 14;
  const end = opts.endDate ?? '2026-10-04';
  const start = addDays(end, -(days - 1));
  const inventory: InventoryRow[] = [], constraints: ConstraintRow[] = [], history: HistoryRow[] = [], truth: Truth[] = [];
  const archetypes: Archetype[] = ['healthy', 'hidden_demand', 'invisible', 'dog'];
  // Stock is drawn per listing, then split across sizes once the portfolio total is known.
  const stock: { styleId: string; styleName: string; channel: Channel; unitCost: number; sold: number; unitsToday: number; fracs: number[] }[] = [];

  for (let i = 0; i < nStyles; i++) {
    const styleId = `ST${String(i + 1).padStart(2, '0')}`;
    const cost = Math.round(between(r, 80, 220));
    const mrp = Math.round(cost * between(r, 2.2, 3.0) / 5) * 5 - 1;
    const amazonPrice = Math.round(mrp * between(r, 0.55, 0.75));
    let floor = Math.round(cost * between(r, 0.6, 1.1));
    if (i === 6 || (opts.floorBelowJobber && r() < 0.2)) floor = Math.round(cost * 0.2); // floor below jobber value
    floor = Math.min(floor, Math.round(amazonPrice * 0.9));
    constraints.push({ styleId, mrp, floor });
    // Two styles had one price cut in the history window (both channels, parity kept).
    const cutDay = i % 9 === 3 ? Math.floor(days / 2) : -1;

    for (const ch of ['amazon', 'noon'] as Channel[]) {
      const arch = i % 7 === 0 && ch === 'noon' ? 'dog' : pick(r, archetypes.concat(['healthy']));
      const pRef = ch === 'amazon' ? amazonPrice : Math.round(amazonPrice * between(r, 0.97, 1.03));
      const t: Truth = {
        listingId: listingId(styleId, ch), archetype: arch, pRef,
        base: arch === 'healthy' ? between(r, 1.8, 3.5) : arch === 'hidden_demand' ? between(r, 0.6, 1.3) : arch === 'invisible' ? between(r, 0.7, 1.4) : between(r, 0.05, 0.3),
        eps: arch === 'hidden_demand' ? between(r, -3.5, -2.5) : arch === 'dog' ? between(r, -1, -0.5) : between(r, -2, -1.2),
        organicSessions: arch === 'invisible' ? between(r, 20, 45) : arch === 'hidden_demand' ? between(r, 180, 300) : arch === 'dog' ? between(r, 20, 50) : between(r, 90, 180),
        adConv: arch === 'invisible' ? between(r, 0.05, 0.08) : arch === 'dog' ? 0.004 : between(r, 0.01, 0.03),
        cpc: ch === 'amazon' ? between(r, 1.5, 3) : between(r, 1, 2.2),
      };
      truth.push(t);
      const cost2 = cost; // same style cost on both channels
      const adSpend = arch === 'invisible' ? Math.round(between(r, 0, 25)) : r() < 0.4 ? Math.round(between(r, 10, 40)) : 0;
      let sold = 0;
      for (let d = 0; d < days; d++) {
        const date = addDays(start, d);
        const price = cutDay >= 0 && d >= cutDay ? Math.round(pRef * 0.9) : pRef;
        const { mean, clicks } = expectedUnits(t, price, adSpend);
        const units = poisson(r, mean);
        sold += units;
        history.push({
          date, styleId, channel: ch, price, sessions: Math.round(t.organicSessions * between(r, 0.8, 1.2) + clicks),
          adSpend, adClicks: Math.round(clicks), unitsSold: units,
        });
      }
      const unitsToday = Math.round(between(r, 36, 108) * (arch === 'dog' ? 1.2 : 1));
      const fracs = SIZES.slice(0, -1).map(() => between(r, 0.1, 0.24));
      stock.push({ styleId, styleName: NAMES[i % NAMES.length], channel: ch, unitCost: cost2, sold, unitsToday, fracs });
    }
  }

  // Optionally scale every listing's stock so the portfolio holds exactly `opts.unitsToday` pairs.
  const totals = opts.unitsToday ? scaleToTotal(stock.map((s) => s.unitsToday), opts.unitsToday) : stock.map((s) => s.unitsToday);
  stock.forEach((s, j) => {
    const unitsToday = totals[j];
    // split across sizes
    let rem = unitsToday, remStart = unitsToday + s.sold;
    SIZES.forEach((size, k) => {
      const last = k === SIZES.length - 1;
      const u = last ? rem : Math.round(unitsToday * s.fracs[k]);
      const take = Math.min(rem, u);
      const us = last ? remStart : Math.min(remStart, take + Math.round((s.sold * take) / Math.max(unitsToday, 1)));
      inventory.push({ styleId: s.styleId, styleName: s.styleName, channel: s.channel, size, unitsStart: us, unitsToday: take, unitCost: s.unitCost });
      rem -= take; remStart -= us;
    });
  });
  return { inventory, constraints, history, truth, today: end };
}

// Demo mode: what tomorrow looks like under the true market, given the current state.
export function simulateNextDay(state: State, truth: Truth[], seed: number): DayRow[] {
  const r = rng(seed);
  const date = addDays(state.today, 1);
  const rows: DayRow[] = [];
  for (const l of state.listings) {
    if (l.delisted) continue;
    const t = truth.find((x) => x.listingId === l.id);
    if (!t) continue;
    const ad = l.unitsLeft > 0 ? l.adSpendPerDay : 0;
    const { mean, clicks } = expectedUnits(t, l.price, ad);
    const units = Math.min(l.unitsLeft, poisson(r, mean));
    rows.push({
      date, listingId: l.id, price: l.price,
      sessions: Math.round(t.organicSessions * between(r, 0.8, 1.2) + clicks),
      adSpend: ad, adClicks: Math.round(clicks), unitsSold: units,
    });
  }
  return rows;
}
