import { ok } from '@/lib/io/http';
import { loadState } from '@/lib/io/store';
import { recommend } from '@/lib/engine/index';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await loadState();
  if (!state) return ok({ loaded: false });
  const { actions, headline } = recommend(state);
  return ok({ loaded: true, actions, headline, warnings: state.warnings, startDate: state.startDate });
}
