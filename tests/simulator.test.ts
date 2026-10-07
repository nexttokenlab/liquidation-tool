// Random unseen worlds: generate data, follow every recommendation for 10 days,
// and assert the rule gate never lets a violation through.
import { describe, it, expect } from 'vitest';
import { generateWorld, simulateNextDay } from '../lib/sim/truth';
import { buildState } from '../lib/engine/build';
import { recommend } from '../lib/engine/index';
import { applyAction } from '../lib/engine/apply';
import { ingestDays } from '../lib/engine/learn';
import { checkAllRules } from '../lib/engine/rules';
import type { State } from '../lib/engine/types';

const WORLDS = 40, DAYS = 10;

describe('simulator: zero rule breaks on random data', () => {
  it(`${WORLDS} worlds × ${DAYS} days, every action applied`, () => {
    let actionsApplied = 0;
    for (let w = 0; w < WORLDS; w++) {
      const world = generateWorld(1000 + w, { styles: 6 + (w % 15), floorBelowJobber: true });
      let st: State = buildState(world.inventory, world.constraints, world.history);
      expect(checkAllRules(st.listings, st.settings)).toEqual([]);
      for (let d = 0; d < DAYS; d++) {
        const { actions } = recommend(st);
        // Every recommended end state must be legal on its own...
        for (const a of actions) {
          const l = st.listings.find((x) => x.id === a.listingId)!;
          if (a.kind !== 'jobber' && !l.delisted) expect(a.toPrice + 0.005).toBeGreaterThanOrEqual(l.floor);
        }
        // ...and applying them in any order must keep the world legal.
        const order = d % 2 ? [...actions].reverse() : actions;
        for (const a of order) {
          const r = applyAction(st, a.listingId);
          if (r.ok) { st = r.state; actionsApplied += r.applied.length; }
          expect(checkAllRules(st.listings, st.settings)).toEqual([]);
        }
        st = ingestDays(st, simulateNextDay(st, world.truth, w * 100 + d)).state;
        expect(checkAllRules(st.listings, st.settings)).toEqual([]);
      }
    }
    expect(actionsApplied).toBeGreaterThan(WORLDS * DAYS);
  }, 120_000);
});
