import { ok, bad, readCsvFields } from '@/lib/io/http';
import { parseHistory } from '@/lib/io/parse';
import { listingId } from '@/lib/engine/build';
import { ingestDays } from '@/lib/engine/learn';
import { loadState, saveState } from '@/lib/io/store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const state = await loadState();
  if (!state) return bad('Load the three starting files first.');
  const f = await readCsvFields(req, ['history']);
  if (!f.history) return bad('Upload or paste the new day rows (same columns as daily_history.csv).');
  const ph = parseHistory(f.history);
  if (ph.errors.length) return bad(ph.errors.join('\n'));
  const rows = ph.rows.map((r) => ({ date: r.date, listingId: listingId(r.styleId, r.channel), price: r.price, sessions: r.sessions, adSpend: r.adSpend, adClicks: r.adClicks, unitsSold: r.unitsSold }));
  const res = ingestDays(state, rows);
  if (res.state.today === state.today) return bad(`No rows after ${state.today}. Nothing new to learn from.`);
  await saveState(res.state);
  return ok({ ok: true, today: res.state.today, learned: res.learned, warnings: [...ph.warnings, ...res.warnings] });
}
