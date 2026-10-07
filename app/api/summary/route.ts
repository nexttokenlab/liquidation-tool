import { ok, bad } from '@/lib/io/http';
import { loadState, saveState } from '@/lib/io/store';
import { recommend } from '@/lib/engine/index';
import { buildPayload, summarize } from '@/lib/llm/summary';

export const dynamic = 'force-dynamic';

// Same numbers -> same note: reuse it so reopening the page doesn't call the LLM again.
// { fresh: true } skips the saved note (the Rewrite button).
export async function POST(req: Request) {
  const state = await loadState();
  if (!state) return bad('Load data first.');
  const { fresh } = await req.json().catch(() => ({}));
  const { actions, headline } = recommend(state);
  const key = JSON.stringify(buildPayload(headline, actions));
  if (!fresh && state.note?.key === key) return ok({ ok: true, lines: state.note.lines, model: state.note.model });
  const r = await summarize(headline, actions);
  const latest = await loadState();
  if (r.ok && latest) await saveState({ ...latest, note: { key, lines: r.lines, model: r.model } });
  return ok(r);
}
