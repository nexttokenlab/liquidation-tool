// Writes synthetic sample files that follow the brief's schema.
// Usage: npm run sample            (seed 7, 3,000 pairs today)
//        npx tsx scripts/generate-sample.ts 42 2500
import { writeFileSync, mkdirSync } from 'fs';
import Papa from 'papaparse';
import { generateWorld } from '../lib/sim/truth';

const seed = Number(process.argv[2] ?? 7);
const pairs = Number(process.argv[3] ?? 3000); // the brief: "about 3,000 pairs"
const w = generateWorld(seed, { unitsToday: pairs });
const dir = 'data/sample';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/inventory.csv`, Papa.unparse(w.inventory.map((r) => ({
  style_id: r.styleId, style_name: r.styleName, channel: r.channel === 'amazon' ? 'Amazon.ae' : 'Noon', size: r.size,
  units_at_window_start: r.unitsStart, units_today: r.unitsToday, unit_cost_aed: r.unitCost,
}))));
writeFileSync(`${dir}/constraints.csv`, Papa.unparse(w.constraints.map((r) => ({
  style_id: r.styleId, original_mrp_aed: r.mrp, liquidation_floor_aed: r.floor,
}))));
writeFileSync(`${dir}/daily_history.csv`, Papa.unparse(w.history.map((r) => ({
  date: r.date, style_id: r.styleId, channel: r.channel === 'amazon' ? 'Amazon.ae' : 'Noon', price_aed: r.price,
  sessions: r.sessions, ad_spend_aed: r.adSpend, ad_clicks: r.adClicks, units_sold: r.unitsSold,
}))));
writeFileSync(`${dir}/truth.json`, JSON.stringify({ seed, note: 'Hidden market used only by "Simulate tomorrow". The engine never reads it.', truth: w.truth }, null, 2));
const units = w.inventory.reduce((a, r) => a + r.unitsToday, 0);
console.log(`Wrote ${dir}: ${w.constraints.length} styles, ${w.history.length} history rows, ${units} pairs today.`);
