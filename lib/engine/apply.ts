import type { Action, Listing, Prediction, State, Violation } from './types';
import { recommend } from './index';
import { checkAllRules, effectiveDate } from './rules';
import { predictPace } from './score';

function applyToListing(l: Listing, a: Action, state: State): Listing {
  const n: Listing = { ...l, priceChangeDates: [...l.priceChangeDates] };
  if (a.kind === 'jobber') {
    n.jobberUnits = l.unitsLeft;
    n.jobberValue = l.unitsLeft * l.unitCost * state.settings.jobberRate;
    n.unitsLeft = 0;
    n.adSpendPerDay = 0;
    n.delisted = true;
    return n;
  }
  if (Math.abs(a.toPrice - l.price) > 0.005) {
    n.price = a.toPrice;
    n.priceChangeDates.push(effectiveDate(state.today));
  }
  n.adSpendPerDay = a.toAd;
  return n;
}

// Violations that are new or worse compared with the state before the change.
function newViolations(before: Violation[], after: Violation[], prev: Listing[], next: Listing[]) {
  const keys = new Set(before.map((v) => v.rule + ':' + v.key));
  return after.filter((v) => {
    if (!keys.has(v.rule + ':' + v.key)) return true;
    if (v.rule === 'ad_budget') {
      const tot = (ls: Listing[]) => ls.filter((l) => l.channel === v.key && !l.delisted).reduce((a, l) => a + l.adSpendPerDay, 0);
      return tot(next) > tot(prev) + 1e-6;
    }
    return false;
  });
}

export type ApplyResult = { ok: true; state: State; applied: Action[]; note?: string } | { ok: false; reason: string };

export function applyAction(state: State, listingId: string): ApplyResult {
  if (state.applied[listingId]) return { ok: false, reason: 'Already applied today.' };
  const { actions } = recommend(state);
  const act = actions.find((a) => a.listingId === listingId);
  if (!act) return { ok: false, reason: 'No recommendation for this listing.' };

  const tryApply = (acts: Action[]) => {
    const next = state.listings.map((l) => {
      const a = acts.find((x) => x.listingId === l.id);
      return a ? applyToListing(l, a, state) : l;
    });
    const v = newViolations(checkAllRules(state.listings, state.settings), checkAllRules(next, state.settings), state.listings, next);
    return { next, v };
  };

  let acts = [act];
  let { next, v } = tryApply(acts);
  let note: string | undefined;
  if (v.length) {
    // Parity is decided per style: apply the partner listing's move in the same step.
    const partner = actions.find((a) => a.styleId === act.styleId && a.listingId !== act.listingId && !a.applied && a.kind !== 'keep');
    const ch = (c: string) => (c === 'noon' ? 'Noon' : 'Amazon');
    if (partner?.kind === 'jobber' && v.some((x) => x.rule === 'parity')) {
      // Never exit stock implicitly: the jobber exit is irreversible and must be Farah's explicit click.
      return { ok: false, reason: `This price only stays within ±5% because the ${ch(partner.channel)} listing exits to the jobber. Apply that exit first, then this.` };
    }
    if (partner) {
      acts = [act, partner];
      ({ next, v } = tryApply(acts));
      note = `Also applied the ${ch(partner.channel)} price for this style, so the two channels stay within ±5%.`;
    }
  }
  if (v.length) {
    const budget = v.find((x) => x.rule === 'ad_budget');
    return {
      ok: false,
      reason: budget
        ? `This would push ${budget.key === 'amazon' ? 'Amazon' : 'Noon'} ads over the daily budget. Apply the recommended ad cuts first.`
        : `Blocked by the rule gate: ${v.map((x) => x.detail).join('; ')}`,
    };
  }

  const eff = effectiveDate(state.today);
  const preds: Prediction[] = acts.filter((a) => a.kind !== 'jobber').map((a) => {
    const e = state.estimates[a.listingId];
    const p = predictPace(e, a.toPrice, a.toAd);
    return {
      listingId: a.listingId, forDate: eff, kind: a.kind, fromPrice: a.fromPrice, toPrice: a.toPrice, toAd: a.toAd,
      basePace: e.basePace, elasticity: e.elasticity, adUnits: p.adUnits, predictedUnits: p.pace,
    };
  });
  const applied = { ...state.applied };
  for (const a of acts) applied[a.listingId] = { ...a, applied: true };
  return {
    ok: true,
    state: { ...state, listings: next, applied, predictions: [...state.predictions, ...preds] },
    applied: acts,
    note,
  };
}
