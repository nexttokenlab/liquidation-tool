import type { Channel, DayRow, Listing, State } from './types';
import { DEFAULT_SETTINGS, type Settings } from '../config';
import { buildEstimates } from './estimate';
import { addDays } from './dates';

export type InventoryRow = { styleId: string; styleName: string; channel: Channel; size: string; unitsStart: number; unitsToday: number; unitCost: number };
export type ConstraintRow = { styleId: string; mrp: number; floor: number };
export type HistoryRow = { date: string; styleId: string; channel: Channel; price: number; sessions: number; adSpend: number; adClicks: number; unitsSold: number };

export const listingId = (styleId: string, ch: Channel) => `${styleId}|${ch}`;

export function buildState(inv: InventoryRow[], cons: ConstraintRow[], hist: HistoryRow[], settings: Settings = DEFAULT_SETTINGS): State {
  const warnings: string[] = [];
  const consBy = new Map(cons.map((c) => [c.styleId, c]));
  const groups = new Map<string, InventoryRow[]>();
  for (const r of inv) {
    const id = listingId(r.styleId, r.channel);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(r);
  }
  const history: DayRow[] = hist.map((h) => ({
    date: h.date, listingId: listingId(h.styleId, h.channel), price: h.price, sessions: h.sessions,
    adSpend: h.adSpend, adClicks: h.adClicks, unitsSold: h.unitsSold,
  }));
  const today = history.reduce((m, r) => (r.date > m ? r.date : m), '0000-00-00');

  const listings: Listing[] = [];
  for (const [id, rows] of groups) {
    const { styleId, channel, styleName } = rows[0];
    const c = consBy.get(styleId);
    if (!c) { warnings.push(`No constraints row for style ${styleId}; listing ${id} skipped.`); continue; }
    const unitsLeft = rows.reduce((a, r) => a + r.unitsToday, 0);
    const unitsStart = rows.reduce((a, r) => a + r.unitsStart, 0);
    const w = rows.reduce((a, r) => a + (r.unitsToday || r.unitsStart), 0);
    const unitCost = w > 0 ? rows.reduce((a, r) => a + r.unitCost * (r.unitsToday || r.unitsStart), 0) / w : rows[0].unitCost;
    const hs = history.filter((h) => h.listingId === id).sort((a, b) => a.date.localeCompare(b.date));
    if (!hs.length) warnings.push(`No history for ${id}; using MRP as price and zero pace.`);
    const changes: string[] = [];
    for (let i = 1; i < hs.length; i++) if (Math.abs(hs[i].price - hs[i - 1].price) > 0.005) changes.push(hs[i].date);
    const last = hs[hs.length - 1];
    listings.push({
      id, styleId, styleName, channel, unitCost, unitsStart, unitsLeft, floor: c.floor, mrp: c.mrp,
      price: last?.price ?? c.mrp, adSpendPerDay: last?.adSpend ?? 0, priceChangeDates: changes,
      delisted: false, jobberUnits: 0, jobberValue: 0,
    });
  }
  listings.sort((a, b) => a.styleId.localeCompare(b.styleId) || a.channel.localeCompare(b.channel));
  const known = new Set(listings.map((l) => l.id));
  const unknownRows = history.filter((h) => !known.has(h.listingId)).length;
  if (unknownRows) warnings.push(`${unknownRows} history rows had no matching inventory and were ignored.`);
  for (const l of listings) if (l.floor > l.price + 0.005) warnings.push(`${l.id}: current price ${l.price} is below floor ${l.floor}; the first recommendation will raise it.`);

  const hist2 = history.filter((h) => known.has(h.listingId));
  const { estimates, pooled } = buildEstimates(listings, hist2, settings);
  return {
    version: 1, startDate: today, today, deadline: addDays(today, settings.horizonDays),
    listings, history: hist2, estimates, pooledElasticity: pooled, applied: {}, predictions: [], settings, warnings,
  };
}
