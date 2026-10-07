// CSV -> typed rows. Headers are matched through an alias map (case, spaces and
// punctuation ignored), values are cleaned ("AED 1,250" -> 1250), then zod validates
// types and ranges before anything reaches the engine.
import Papa from 'papaparse';
import { z } from 'zod';
import type { Channel } from '../engine/types';
import type { ConstraintRow, HistoryRow, InventoryRow } from '../engine/build';

const norm = (h: string) => h.toLowerCase().replace(/\(.*?\)/g, '').replace(/aed/g, '').replace(/[^a-z0-9]/g, '');

const ALIASES: Record<string, string[]> = {
  styleId: ['styleid', 'style', 'stylecode', 'styleno', 'sku', 'skuid', 'productid', 'article'],
  styleName: ['stylename', 'name', 'productname', 'title', 'description'],
  channel: ['channel', 'marketplace', 'platform', 'site'],
  size: ['size', 'shoesize', 'eusize', 'uksize'],
  unitsStart: ['unitsatwindowstart', 'unitsatstart', 'unitsstart', 'startunits', 'openingunits', 'openingstock', 'unitswindowstart', 'startingunits', 'stockatstart'],
  unitsToday: ['unitstoday', 'unitsnow', 'currentunits', 'unitsleft', 'stocktoday', 'currentstock', 'unitsonhand', 'closingstock', 'stock'],
  unitCost: ['unitcost', 'cost', 'costperunit', 'landedcost', 'cogs'],
  mrp: ['originalmrp', 'mrp', 'listprice', 'originalprice', 'rrp'],
  floor: ['liquidationfloor', 'liquidationpricefloor', 'pricefloor', 'floor', 'floorprice', 'liquidationprice', 'minprice', 'minimumprice'],
  date: ['date', 'day', 'reportdate'],
  price: ['price', 'sellingprice', 'saleprice', 'currentprice', 'listingprice'],
  sessions: ['sessions', 'visits', 'pageviews', 'traffic'],
  adSpend: ['adspend', 'spend', 'adcost', 'advertisingspend', 'adsspend'],
  adClicks: ['adclicks', 'clicks', 'adsclicks'],
  unitsSold: ['unitssold', 'units', 'sold', 'qtysold', 'orders', 'unitsordered', 'sales'],
};

export type ParseResult<T> = { rows: T[]; errors: string[]; warnings: string[]; mapping: Record<string, string> };

function mapHeaders(headers: string[], needed: string[], optional: string[] = []) {
  const mapping: Record<string, string> = {};
  const errors: string[] = [];
  for (const field of [...needed, ...optional]) {
    const hit = headers.find((h) => ALIASES[field].includes(norm(h))) ??
      headers.find((h) => ALIASES[field].some((a) => a.length > 4 && norm(h).includes(a)));
    if (hit) mapping[field] = hit;
    else if (needed.includes(field)) errors.push(`Missing column for "${field}". Found: ${headers.join(', ')}`);
  }
  return { mapping, errors };
}

const num = (v: unknown) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/aed/gi, '').replace(/[, ]/g, '').trim();
  return s === '' ? NaN : Number(s);
};

export function parseChannel(v: unknown): Channel | null {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('amazon') || s === 'amz' || s === 'az') return 'amazon';
  if (s.includes('noon')) return 'noon';
  return null;
}

export function parseDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // DD/MM/YYYY (GCC convention)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

function readCsv(text: string) {
  const res = Papa.parse<Record<string, unknown>>(text.trim(), { header: true, skipEmptyLines: true, dynamicTyping: false });
  return { data: res.data, headers: res.meta.fields ?? [], errors: res.errors.slice(0, 3).map((e) => `CSV row ${e.row}: ${e.message}`) };
}

const nonNeg = z.number().finite().min(0);
const pos = z.number().finite().positive();

function run<T>(text: string, needed: string[], optional: string[], build: (get: (f: string) => unknown, i: number) => T | string, schema: z.ZodType<T>): ParseResult<T> {
  const { data, headers, errors: csvErr } = readCsv(text);
  const { mapping, errors } = mapHeaders(headers, needed, optional);
  if (errors.length) return { rows: [], errors: [...csvErr, ...errors], warnings: [], mapping };
  const rows: T[] = [], rowErrors: string[] = [];
  data.forEach((raw, i) => {
    const out = build((f) => (mapping[f] ? raw[mapping[f]] : undefined), i);
    if (typeof out === 'string') { rowErrors.push(`Row ${i + 2}: ${out}`); return; }
    const v = schema.safeParse(out);
    if (!v.success) rowErrors.push(`Row ${i + 2}: ${v.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
    else rows.push(v.data);
  });
  const warnings = rowErrors.length && rows.length ? [`${rowErrors.length} rows rejected`, ...rowErrors.slice(0, 5)] : [];
  return { rows, errors: rows.length ? [] : [...csvErr, ...rowErrors.slice(0, 5)], warnings, mapping };
}

export const parseInventory = (text: string) =>
  run<InventoryRow>(text, ['styleId', 'channel', 'unitsToday', 'unitCost'], ['styleName', 'size', 'unitsStart'], (g) => {
    const channel = parseChannel(g('channel'));
    if (!channel) return `unknown channel "${g('channel')}"`;
    const unitsToday = num(g('unitsToday'));
    return {
      styleId: String(g('styleId')).trim(), styleName: String(g('styleName') ?? g('styleId')).trim(), channel,
      size: String(g('size') ?? 'all'), unitsStart: g('unitsStart') === undefined ? unitsToday : num(g('unitsStart')),
      unitsToday, unitCost: num(g('unitCost')),
    };
  }, z.object({ styleId: z.string().min(1), styleName: z.string(), channel: z.enum(['amazon', 'noon']), size: z.string(), unitsStart: nonNeg, unitsToday: nonNeg, unitCost: pos }));

export const parseConstraints = (text: string) =>
  run<ConstraintRow>(text, ['styleId', 'floor'], ['mrp'], (g) => ({
    styleId: String(g('styleId')).trim(), floor: num(g('floor')), mrp: g('mrp') === undefined ? num(g('floor')) * 4 : num(g('mrp')),
  }), z.object({ styleId: z.string().min(1), floor: pos, mrp: pos }));

export const parseHistory = (text: string) =>
  run<HistoryRow>(text, ['date', 'styleId', 'channel', 'price', 'unitsSold'], ['sessions', 'adSpend', 'adClicks'], (g) => {
    const channel = parseChannel(g('channel'));
    if (!channel) return `unknown channel "${g('channel')}"`;
    const date = parseDate(g('date'));
    if (!date) return `bad date "${g('date')}"`;
    const opt = (f: string) => (g(f) === undefined || g(f) === '' ? 0 : num(g(f)));
    return {
      date, styleId: String(g('styleId')).trim(), channel, price: num(g('price')),
      sessions: opt('sessions'), adSpend: opt('adSpend'), adClicks: opt('adClicks'), unitsSold: num(g('unitsSold')),
    };
  }, z.object({ date: z.string(), styleId: z.string().min(1), channel: z.enum(['amazon', 'noon']), price: pos, sessions: nonNeg, adSpend: nonNeg, adClicks: nonNeg, unitsSold: nonNeg }));
