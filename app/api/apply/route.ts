import { ok, bad } from '@/lib/io/http';
import { loadState, saveState } from '@/lib/io/store';
import { applyAction } from '@/lib/engine/apply';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const state = await loadState();
  if (!state) return bad('Load data first.');
  const { listingId } = await req.json().catch(() => ({}));
  if (typeof listingId !== 'string') return bad('listingId is required.');
  const r = applyAction(state, listingId);
  if (!r.ok) return bad(r.reason, 409);
  await saveState(r.state);
  return ok({ ok: true, applied: r.applied.map((a) => a.listingId), note: r.note });
}
