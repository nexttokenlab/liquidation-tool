import { ok, bad, readCsvFields } from '@/lib/io/http';
import { parseConstraints, parseHistory, parseInventory } from '@/lib/io/parse';
import { buildState } from '@/lib/engine/build';
import { readSample, saveState } from '@/lib/io/store';
import { checkAllRules } from '@/lib/engine/rules';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const f = await readCsvFields(req, ['inventory', 'constraints', 'history']);
  const inv = f.useSample ? await readSample('inventory.csv') : f.inventory;
  const con = f.useSample ? await readSample('constraints.csv') : f.constraints;
  const his = f.useSample ? await readSample('daily_history.csv') : f.history;
  if (!inv || !con || !his) return bad('All three files are needed: inventory, constraints and daily history.');
  const pi = parseInventory(inv), pc = parseConstraints(con), ph = parseHistory(his);
  const errors = [
    ...pi.errors.map((e) => `inventory: ${e}`), ...pc.errors.map((e) => `constraints: ${e}`), ...ph.errors.map((e) => `history: ${e}`),
  ];
  if (errors.length) return bad(errors.join('\n'));
  const state = buildState(pi.rows, pc.rows, ph.rows);
  if (!state.listings.length) return bad('No listings could be built from these files.');
  state.warnings.push(...pi.warnings, ...pc.warnings, ...ph.warnings);
  const pre = checkAllRules(state.listings, state.settings);
  if (pre.length) state.warnings.push(...pre.map((v) => `Data already breaks a rule: ${v.detail}`));
  await saveState(state);
  return ok({
    ok: true, listings: state.listings.length, today: state.today, deadline: state.deadline, warnings: state.warnings,
    mapping: { inventory: pi.mapping, constraints: pc.mapping, history: ph.mapping }, sample: !!f.useSample,
  });
}
