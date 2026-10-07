// Demo only: generates tomorrow's rows from the hidden sample market, then runs the normal new-day path.
import { ok, bad } from '@/lib/io/http';
import { ingestDays } from '@/lib/engine/learn';
import { loadState, readSample, saveState } from '@/lib/io/store';
import { simulateNextDay, type Truth } from '@/lib/sim/truth';
import { daysLeft } from '@/lib/engine/index';

export const dynamic = 'force-dynamic';

export async function POST() {
  const state = await loadState();
  if (!state) return bad('Load data first.');
  if (daysLeft(state) <= 0) return bad('The 60-day window is over.');
  let truth: Truth[];
  try { truth = JSON.parse(await readSample('truth.json')).truth; } catch { return bad('Simulation needs the bundled sample data.'); }
  if (!state.listings.every((l) => truth.some((t) => t.listingId === l.id))) return bad('Simulation only works with the bundled sample data.');
  const rows = simulateNextDay(state, truth, state.history.length + 17);
  const res = ingestDays(state, rows);
  await saveState(res.state);
  return ok({ ok: true, today: res.state.today, learned: res.learned, warnings: res.warnings, rows: rows.length });
}
