import type { Channel, DayRow, Estimate, Listing, State } from './types';
import type { Settings } from '../config';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function rowsByListing(history: DayRow[]) {
  const m = new Map<string, DayRow[]>();
  for (const r of history) {
    if (!m.has(r.listingId)) m.set(r.listingId, []);
    m.get(r.listingId)!.push(r);
  }
  for (const rows of m.values()) rows.sort((a, b) => a.date.localeCompare(b.date));
  return m;
}

// Recent window, but never blending across a price change: if the price changed
// inside the window, use only the days at the current price (min 3 days).
export function recentRows(rows: DayRow[], window: number) {
  const last = rows.slice(-window);
  if (!last.length) return last;
  const p = last[last.length - 1].price;
  let i = last.length - 1;
  while (i > 0 && Math.abs(last[i - 1].price - p) < 0.005) i--;
  const samePrice = last.slice(i);
  return samePrice.length >= 3 ? samePrice : last;
}

// Elasticity measured from a past price change: pace 7 days before vs after.
function measuredElasticity(rows: DayRow[], bounds: [number, number]): number | null {
  const results: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const p1 = rows[i - 1].price, p2 = rows[i].price;
    if (Math.abs(p2 - p1) < 0.005) continue;
    const before = rows.slice(Math.max(0, i - 7), i);
    const after = rows.slice(i, i + 7);
    if (before.length < 3 || after.length < 3) continue;
    const pace = (rs: DayRow[]) => sum(rs.map((r) => r.unitsSold)) / rs.length;
    const a = pace(before), b = pace(after);
    if (a <= 0 || b <= 0) continue;
    results.push(clamp(Math.log(b / a) / Math.log(p2 / p1), bounds[0], bounds[1]));
  }
  return results.length ? results[results.length - 1] : null;
}

export function buildEstimates(
  listings: Listing[],
  history: DayRow[],
  settings: Settings,
  previous?: State['estimates'],
  pooledPrev?: Record<Channel, number>,
) {
  const byL = rowsByListing(history);
  // Channel-level cost per click, used where a listing has no clicks of its own.
  const chCpc: Record<Channel, number> = { amazon: 2, noon: 2 };
  for (const ch of ['amazon', 'noon'] as Channel[]) {
    const rs = history.filter((r) => r.listingId.endsWith('|' + ch));
    const spend = sum(rs.map((r) => r.adSpend)), clicks = sum(rs.map((r) => r.adClicks));
    if (clicks > 0) chCpc[ch] = spend / clicks;
  }

  // Pooled elasticity per channel = prior blended with every measured listing.
  const measured: Record<string, number | null> = {};
  const pooled: Record<Channel, number> = pooledPrev ? { ...pooledPrev } : { amazon: settings.priorElasticity, noon: settings.priorElasticity };
  if (!pooledPrev) {
    for (const ch of ['amazon', 'noon'] as Channel[]) {
      const vals: number[] = [];
      for (const l of listings.filter((x) => x.channel === ch)) {
        const e = measuredElasticity(byL.get(l.id) ?? [], settings.elasticityBounds);
        measured[l.id] = e;
        if (e !== null) vals.push(e);
      }
      if (vals.length) pooled[ch] = 0.5 * settings.priorElasticity + 0.5 * (sum(vals) / vals.length);
    }
  } else {
    for (const l of listings) measured[l.id] = measuredElasticity(byL.get(l.id) ?? [], settings.elasticityBounds);
  }

  const out: State['estimates'] = {};
  for (const l of listings) {
    const all = byL.get(l.id) ?? [];
    const prev = previous?.[l.id];

    // 1. Price sensitivity: own learning > own measured change > pooled/prior.
    let elasticity = pooled[l.channel];
    let source: Estimate['elasticitySource'] =
      Math.abs(pooled[l.channel] - settings.priorElasticity) < 1e-9 ? 'prior' : 'pooled';
    if (prev && prev.elasticitySource === 'own') {
      elasticity = prev.elasticity;
      source = 'own';
    } else if (measured[l.id] != null) {
      elasticity = 0.5 * measured[l.id]! + 0.5 * pooled[l.channel];
      source = 'own';
    }

    // 2. Pace, conversion, cost per click over the recent window.
    const rs = recentRows(all, settings.recentWindow);
    const n = Math.max(rs.length, 1);
    const units = sum(rs.map((r) => r.unitsSold));
    const sessions = sum(rs.map((r) => r.sessions));
    const spend = sum(rs.map((r) => r.adSpend));
    const clicks = sum(rs.map((r) => r.adClicks));
    const conversion = sessions > 0 ? units / sessions : 0;
    const cpc = clicks > 0 && spend > 0 ? spend / clicks : chCpc[l.channel];
    const adMultiplier = prev?.adMultiplier ?? 1;
    const p0 = l.price;
    // Organic units per day, each day restated at today's price so days at an
    // older price do not blur the estimate.
    const organic = rs.map((r) => {
      const adU = (r.adSpend / cpc) * conversion * adMultiplier;
      return Math.max(0, r.unitsSold - adU) * Math.pow(p0 / r.price, elasticity);
    });
    const basePace = sum(organic) / n;
    const recentPace = units / n;
    const sd = Math.sqrt(sum(rs.map((r) => (r.unitsSold - recentPace) ** 2)) / n);

    out[l.id] = {
      basePace,
      p0,
      elasticity,
      elasticitySource: source,
      conversion,
      cpc,
      adMultiplier,
      recentPace,
      sessionsPerDay: sessions / n,
      dailyCv: recentPace > 0 ? sd / recentPace : 1,
    };
  }
  return { estimates: out, pooled };
}

export function peerMedians(listings: Listing[], est: State['estimates']) {
  const active = listings.filter((l) => !l.delisted && l.unitsLeft > 0);
  return {
    sessions: median(active.map((l) => est[l.id]?.sessionsPerDay ?? 0)),
    conversion: median(active.map((l) => est[l.id]?.conversion ?? 0)),
  };
}
