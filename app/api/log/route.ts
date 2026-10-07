import { ok } from '@/lib/io/http';
import { loadState } from '@/lib/io/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await loadState();
  if (!state) return ok({ loaded: false, predictions: [] });
  const predictions = [...state.predictions].sort((a, b) => b.forDate.localeCompare(a.forDate));
  return ok({ loaded: true, today: state.today, predictions, pooled: state.pooledElasticity });
}
