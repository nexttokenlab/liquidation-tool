import type { Action, ActionKind, Channel, Confidence, Estimate, ExplainLine, Headline, Listing, State, Status } from './types';
import { canChangePrice, effectiveDate, noonBand, parityOk, roundPrice, PRICE_EPS } from './rules';
import { jobberNowValue, moneyRecovered, predictPace } from './score';
import { addDays, diffDays, fmtDay } from './dates';
import { peerMedians } from './estimate';

type Opt = { kind: 'keep' | 'price' | 'jobber' | 'delisted'; price: number; forced?: boolean };
type Scored = { value: number; ad: number; pace: number; sold: number; leftover: number; adCost: number; holding: number };

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (x: number) => (x * 100).toFixed(1) + '%';
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const ZERO: Scored = { value: 0, ad: 0, pace: 0, sold: 0, leftover: 0, adCost: 0, holding: 0 };

export function daysLeft(state: State) {
  return Math.max(0, diffDays(state.deadline, state.today));
}

function scoreAt(l: Listing, est: Estimate, price: number, ad: number, state: State): Scored {
  const s = state.settings;
  const { pace } = predictPace(est, price, ad);
  const r = moneyRecovered(pace, {
    price, adPerDay: ad, stock: l.unitsLeft, daysLeft: daysLeft(state), unitCost: l.unitCost,
    holdingPerUnitPerDay: s.holdingPerUnitPerDay, jobberRate: s.jobberRate, feeRate: s.feeRate,
  });
  return { value: r.value, ad, pace, sold: r.sold, leftover: r.leftover, adCost: r.adCost, holding: r.holding };
}

const adLevels = (state: State) => state.settings.adSteps.filter((a) => a <= state.settings.maxAdPerListing);

function bestWithAds(l: Listing, est: Estimate, price: number, state: State, levels = adLevels(state)): Scored {
  if (l.unitsLeft <= 0) return scoreAt(l, est, price, 0, state);
  let best: Scored | null = null;
  for (const a of levels) {
    const sc = scoreAt(l, est, price, a, state);
    if (!best || sc.value > best.value) best = sc;
  }
  return best ?? scoreAt(l, est, price, 0, state);
}

// Approach note: On-track listings keep their ads; Ahead listings may only spend less; Behind listings choose freely.
function adChoices(l: Listing, status: Status, state: State): number[] {
  if (status === 'on_track') return [l.adSpendPerDay];
  const all = adLevels(state);
  if (status !== 'ahead') return all;
  return [...new Set([...all.filter((a) => a <= l.adSpendPerDay), l.adSpendPerDay])].sort((x, y) => x - y);
}

function statusOf(l: Listing, est: Estimate, D: number, band: number): { status: Status; needed: number } {
  if (l.delisted) return { status: 'exited', needed: 0 };
  if (l.unitsLeft <= 0) return { status: 'cleared', needed: 0 };
  const needed = D > 0 ? l.unitsLeft / D : l.unitsLeft;
  const r = est.recentPace / needed;
  return { status: r >= 1 + band ? 'ahead' : r < 1 - band ? 'behind' : 'on_track', needed };
}

function dedupe(opts: Opt[]) {
  const seen = new Set<string>();
  return opts.filter((o) => {
    const k = o.kind + ':' + o.price.toFixed(2);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Candidate prices for one listing. Small steps only while price response is unproven.
// Approach note: only Behind listings get price cuts or a jobber exit; On-track and Ahead listings
// keep their price (2 changes a week are scarce), unless a partner's move forces one for parity.
function priceOptions(l: Listing, est: Estimate, status: Status, state: State): Opt[] {
  if (l.delisted) return [{ kind: 'delisted', price: l.price }];
  const opts: Opt[] = [{ kind: 'keep', price: l.price }];
  if (l.unitsLeft <= 0 || status !== 'behind') return opts;
  const s = state.settings;
  if (canChangePrice(l, effectiveDate(state.today), s)) {
    const proven = est.elasticitySource === 'own';
    const steps = s.priceSteps.filter((st) => proven || st >= s.smallStepLimit - 1e-9);
    const prices = steps.map((st) => roundPrice(l.price * (1 + st), l.floor));
    if (proven || l.floor >= l.price * (1 + s.smallStepLimit)) prices.push(roundPrice(l.floor, l.floor));
    for (const p of prices) if (Math.abs(p - l.price) > PRICE_EPS && p + PRICE_EPS >= l.floor) opts.push({ kind: 'price', price: p });
  }
  opts.push({ kind: 'jobber', price: l.price });
  return dedupe(opts);
}

const isPriced = (o: Opt) => o.kind === 'keep' || o.kind === 'price';

export function recommend(state: State): { actions: Action[]; headline: Headline } {
  const s = state.settings;
  const D = daysLeft(state);
  const est = state.estimates;
  const eff = effectiveDate(state.today);
  const peers = peerMedians(state.listings, est);
  const statusById = new Map(state.listings.map((l) => [l.id, statusOf(l, est[l.id], D, s.statusBand).status]));
  const statusOfId = (l: Listing) => statusById.get(l.id)!;
  const byStyle = new Map<string, Listing[]>();
  for (const l of state.listings) {
    if (!byStyle.has(l.styleId)) byStyle.set(l.styleId, []);
    byStyle.get(l.styleId)!.push(l);
  }

  function scoreOpt(l: Listing, o: Opt): Scored {
    if (o.kind === 'delisted') return ZERO;
    if (o.kind === 'jobber') return { ...ZERO, value: jobberNowValue(l.unitsLeft, l.unitCost, s.jobberRate) };
    if (state.applied[l.id]) return scoreAt(l, est[l.id], l.price, l.adSpendPerDay, state);
    return bestWithAds(l, est[l.id], o.price, state, adChoices(l, statusOfId(l), state));
  }

  // ---- Stage 1: choose price (or exit) jointly per style, so parity always holds.
  const plan = new Map<string, { opt: Opt; scored: Scored; forcedByPartner: boolean }>();
  for (const [, ls] of byStyle) {
    const a = ls.find((l) => l.channel === 'amazon');
    const n = ls.find((l) => l.channel === 'noon');
    const fixed = (l?: Listing) => !!l && !!state.applied[l.id];
    const optsFor = (l: Listing | undefined): Opt[] => {
      if (!l) return [];
      if (fixed(l)) return [{ kind: l.delisted ? 'delisted' : 'keep', price: l.price }];
      return priceOptions(l, est[l.id], statusOfId(l), state);
    };
    const aOpts = optsFor(a);
    let nOpts = optsFor(n);
    // Noon prices that track each Amazon option, clamped into the ±5% band.
    if (a && n && !fixed(n) && !n.delisted && n.unitsLeft > 0 && canChangePrice(n, eff, s)) {
      for (const ao of aOpts.filter(isPriced)) {
        const [lo, hi] = noonBand(ao.price, s);
        let p = roundPrice(Math.min(hi, Math.max(lo, n.price * (ao.price / a.price))), n.floor);
        if (p > hi + PRICE_EPS) p = Math.floor(hi);
        if (p + PRICE_EPS >= n.floor && Math.abs(p - n.price) > PRICE_EPS && parityOk(ao.price, p, s))
          nOpts.push({ kind: 'price', price: p, forced: true });
      }
      nOpts = dedupe(nOpts);
    }

    if (!a || !n) {
      for (const l of ls) {
        let best: { opt: Opt; scored: Scored } | null = null;
        for (const o of l === a ? aOpts : nOpts) {
          const sc = scoreOpt(l, o);
          if (!best || sc.value > best.scored.value + 1e-6) best = { opt: o, scored: sc };
        }
        plan.set(l.id, { ...best!, forcedByPartner: false });
      }
      continue;
    }

    let best: { ao: Opt; no: Opt; as: Scored; ns: Scored; total: number; changes: number } | null = null;
    for (const ao of aOpts) {
      const as = scoreOpt(a, ao);
      for (const no of nOpts) {
        if (isPriced(ao) && isPriced(no) && !parityOk(ao.price, no.price, s)) continue;
        const ns = scoreOpt(n, no);
        const total = as.value + ns.value;
        const changes = (ao.kind === 'keep' ? 0 : 1) + (no.kind === 'keep' ? 0 : 1);
        if (!best || total > best.total + 1e-6 || (Math.abs(total - best.total) <= 1e-6 && changes < best.changes))
          best = { ao, no, as, ns, total, changes };
      }
    }
    if (!best) {
      // Only reachable if the current prices already break parity; exit is always legal.
      const j: Opt = { kind: 'jobber', price: a.price };
      best = { ao: aOpts[0], no: j, as: scoreOpt(a, aOpts[0]), ns: scoreOpt(n, j), total: 0, changes: 1 };
    }
    plan.set(a.id, { opt: best.ao, scored: best.as, forcedByPartner: false });
    plan.set(n.id, { opt: best.no, scored: best.ns, forcedByPartner: !!best.no.forced && best.ao.kind === 'price' });
  }

  // ---- Stage 2: allocate each channel's daily ad budget greedily by AED gained per AED spent.
  const adPlan = new Map<string, number>();
  for (const ch of ['amazon', 'noon'] as Channel[]) {
    const ls = state.listings.filter((l) => l.channel === ch);
    let budget = s.adBudget[ch];
    // Applied and On-track listings keep their current ads; the rest of the budget is shared out.
    const holds = (l: Listing) => !!state.applied[l.id] || (statusOfId(l) === 'on_track' && !l.delisted && l.unitsLeft > 0);
    for (const l of ls) {
      if (holds(l)) {
        adPlan.set(l.id, l.adSpendPerDay);
        budget -= l.adSpendPerDay;
      } else adPlan.set(l.id, 0);
    }
    const eligible = ls.filter((l) => !holds(l) && isPriced(plan.get(l.id)!.opt) && l.unitsLeft > 0 && !l.delisted);
    for (let guard = 0; guard < 500; guard++) {
      let pick: { l: Listing; ad: number; ratio: number } | null = null;
      for (const l of eligible) {
        const cur = adPlan.get(l.id)!;
        const price = plan.get(l.id)!.opt.price;
        const base = scoreAt(l, est[l.id], price, cur, state).value;
        for (const a of adChoices(l, statusOfId(l), state)) {
          if (a <= cur || a - cur > budget + 1e-9) continue;
          const gain = scoreAt(l, est[l.id], price, a, state).value - base;
          const ratio = gain / (a - cur);
          if (gain > 1e-6 && (!pick || ratio > pick.ratio)) pick = { l, ad: a, ratio };
        }
      }
      if (!pick) break;
      budget -= pick.ad - adPlan.get(pick.l.id)!;
      adPlan.set(pick.l.id, pick.ad);
    }
  }

  // ---- Stage 3: final numbers, last jobber check, reasons.
  const actions: Action[] = [];
  // Changes in the 7 days ending tomorrow, counting one already applied for tomorrow.
  const changesLeft = (l: Listing) =>
    Math.max(0, s.maxPriceChangesPer7d - new Set(l.priceChangeDates.filter((d) => diffDays(eff, d) >= 0 && diffDays(eff, d) <= 6)).size);
  for (const l of state.listings) {
    if (state.applied[l.id]) {
      actions.push({ ...state.applied[l.id], unitCost: l.unitCost, floor: l.floor, mrp: l.mrp, priceChangesLeft: changesLeft(l), applied: true });
      continue;
    }
    const e = est[l.id];
    const p = plan.get(l.id)!;
    const { status, needed } = statusOf(l, e, D, s.statusBand);
    const keep = l.delisted ? ZERO : scoreAt(l, e, l.price, l.unitsLeft > 0 ? l.adSpendPerDay : 0, state);
    let kind: ActionKind = 'keep';
    let toPrice = l.price, toAd = l.adSpendPerDay;
    let final: Scored = keep;
    let online: Scored = ZERO;
    if (l.delisted) {
      toAd = 0;
    } else if (p.opt.kind === 'jobber') {
      kind = 'jobber';
      toAd = 0;
      final = scoreOpt(l, p.opt);
    } else {
      toPrice = p.opt.price;
      toAd = l.unitsLeft > 0 ? adPlan.get(l.id) ?? 0 : 0;
      final = scoreAt(l, e, toPrice, toAd, state);
      const jobber = jobberNowValue(l.unitsLeft, l.unitCost, s.jobberRate);
      if (status === 'behind' && l.unitsLeft > 0 && jobber > final.value + 1e-6) {
        kind = 'jobber';
        toPrice = l.price;
        toAd = 0;
        final = { ...ZERO, value: jobber };
      } else {
        const pc = Math.abs(toPrice - l.price) > PRICE_EPS;
        const ac = Math.abs(toAd - l.adSpendPerDay) > 0.5;
        kind = pc && ac ? 'price_ads' : pc ? 'price' : ac ? 'ads' : 'keep';
      }
    }
    if (kind === 'jobber') {
      // Best legal online plan, for comparison with exiting now.
      const plans = priceOptions(l, e, status, state).filter(isPriced).map((o) => bestWithAds(l, e, o.price, state));
      online = plans.reduce((b, x) => (x.value > b.value ? x : b), plans[0] ?? ZERO);
    }
    const conf: Confidence =
      kind === 'price' || kind === 'price_ads'
        ? e.elasticitySource === 'own' ? 'high' : e.elasticitySource === 'pooled' ? 'med' : 'low'
        : kind === 'ads' ? (e.sessionsPerDay * 7 >= 300 ? 'med' : 'low')
        : e.dailyCv < 0.6 ? 'high' : 'med';
    actions.push({
      id: `${state.today}|${l.id}`,
      listingId: l.id, styleId: l.styleId, styleName: l.styleName, channel: l.channel,
      kind, fromPrice: l.price, toPrice, fromAd: l.adSpendPerDay, toAd,
      predictedPace: final.pace,
      projectedValue: final.value,
      keepValue: keep.value,
      gainVsKeep: final.value - keep.value,
      unitsLeft: l.unitsLeft,
      unitsLeftAtDeadline: kind === 'jobber' ? 0 : final.leftover,
      unitCost: l.unitCost, floor: l.floor, mrp: l.mrp, priceChangesLeft: changesLeft(l),
      status, neededPace: needed, actualPace: e.recentPace,
      confidence: conf,
      explain: explain(l, e, kind, toPrice, toAd, final, keep, online, peers, p.forcedByPartner, status, needed, state),
      applied: false,
    });
  }

  const costOf = (id: string) => state.listings.find((y) => y.id === id)!.unitCost;
  const sumCh = (ch: Channel, f: (x: Action) => number) => actions.filter((x) => x.channel === ch).reduce((a, x) => a + f(x), 0);
  const headline: Headline = {
    today: state.today,
    deadline: state.deadline,
    daysLeft: D,
    unitsLeft: state.listings.reduce((a, l) => a + (l.delisted ? 0 : l.unitsLeft), 0),
    unitsLeftAtDeadline: actions.reduce((a, x) => a + x.unitsLeftAtDeadline, 0),
    jobberValueAtDeadline: actions.reduce((a, x) => a + x.unitsLeftAtDeadline * costOf(x.listingId) * s.jobberRate, 0),
    projectedRecovery: actions.reduce((a, x) => a + x.projectedValue, 0),
    keepRecovery: actions.reduce((a, x) => a + x.keepValue, 0),
    alreadyRecoveredJobber: state.listings.reduce((a, l) => a + l.jobberValue, 0),
    adBudgetPlanned: { amazon: sumCh('amazon', (x) => x.toAd), noon: sumCh('noon', (x) => x.toAd) },
    adBudgetCurrent: {
      amazon: state.listings.filter((l) => l.channel === 'amazon' && !l.delisted).reduce((a, l) => a + l.adSpendPerDay, 0),
      noon: state.listings.filter((l) => l.channel === 'noon' && !l.delisted).reduce((a, l) => a + l.adSpendPerDay, 0),
    },
    adBudget: s.adBudget,
  };
  actions.sort((x, y) => Number(x.applied) - Number(y.applied) || y.gainVsKeep - x.gainVsKeep);
  return { actions, headline };
}

// Plain-language explanation built only from numbers the engine computed:
// Why (the reason for this listing), Expect (what should happen), Ads, Note (caveats).
function explain(
  l: Listing, e: Estimate, kind: ActionKind, toPrice: number, toAd: number, final: Scored, keep: Scored, online: Scored,
  peers: { sessions: number; conversion: number }, forced: boolean, status: Status, needed: number, state: State,
): ExplainLine[] {
  const s = state.settings;
  const out: ExplainLine[] = [];
  const add = (label: ExplainLine['label'], text: string) => { if (text) out.push({ label, text }); };
  if (l.delisted) { add('Why', `Exited to the jobber: ${fmt(l.jobberUnits)} pairs for AED ${fmt(l.jobberValue)}.`); return out; }
  if (l.unitsLeft <= 0) { add('Why', 'Sold out. Ads stay off.'); return out; }

  const by = fmtDay(state.deadline);
  const ch = l.channel === 'amazon' ? 'Amazon' : 'Noon';
  const jobberPair = l.unitCost * s.jobberRate;
  const jobberRule = Number.isInteger(1 / s.jobberRate) ? `cost ÷ ${1 / s.jobberRate}` : `${s.jobberRate * 100}% of cost`;
  const pace = `sells ${one(e.recentPace)}/day, needs ${one(needed)}/day to clear ${fmt(l.unitsLeft)} pairs by ${by}`;
  const standing = status === 'behind' ? 'Behind pace' : status === 'ahead' ? 'Ahead of pace' : 'On pace';
  const clearsOn = (sc: Scored) => (sc.leftover < 0.5 && sc.pace > 0 ? fmtDay(addDays(state.today, Math.ceil(l.unitsLeft / sc.pace))) : null);
  const clear = clearsOn(final);
  const ending = clear ? `, clearing by ${clear}` : `, ${fmt(final.leftover)} left on ${by}`;
  const more = fmt(final.sold - keep.sold);
  const toJobber = keep.leftover >= 0.5 ? ' instead of going to the jobber' : '';
  const atToday = keep.leftover >= 0.5 ? ` At today's price and ads about ${fmt(keep.leftover)} pairs go to the jobber on ${by}.` : '';
  const lowSessions = e.sessionsPerDay < 0.7 * peers.sessions;
  const lowConv = e.conversion < 0.7 * peers.conversion;
  const conv = pct(e.conversion);

  // Ads: what the change in daily spend buys or gives up, in clicks and pairs.
  const adDiff = Math.abs(toAd - l.adSpendPerDay);
  const adUnits = (adDiff / e.cpc) * e.conversion * e.adMultiplier;
  const adUp = `The extra AED ${fmt(adDiff)}/day buys about ${fmt(adDiff / e.cpc)} clicks (AED ${e.cpc.toFixed(2)} each); at ${conv} conversion that's about ${one(adUnits)} more pairs a day.`;
  const adCut = () => {
    if (clear) return `Sells out by ${clear} even ${toAd === 0 ? 'without ads' : `at AED ${fmt(toAd)}/day`}, so the ads only speed up sales you'd get anyway.`;
    const withAds = scoreAt(l, e, toPrice, l.adSpendPerDay, state);
    if (withAds.value < final.value) {
      const extra = withAds.sold - final.sold;
      return `Ads aren't paying back: ${toAd === 0 ? 'without ads' : `at AED ${fmt(toAd)}/day`} it still sells about ${fmt(final.sold)} of ${fmt(l.unitsLeft)} pairs by ${by}. The AED ${fmt(adDiff)}/day adds only ${extra < 1 ? 'about 1' : fmt(extra)} more but costs AED ${fmt(withAds.adCost - final.adCost)} over that time.`;
    }
    return `Other ${ch} listings sell more pairs per AED, so the channel's AED ${fmt(s.adBudget[l.channel])}/day budget goes to them first.`;
  };

  switch (kind) {
    case 'jobber': {
      const jobber = jobberNowValue(l.unitsLeft, l.unitCost, s.jobberRate);
      add('Why', `Online it ${pace}. Even at the best legal price and ads, ${online.sold < 1 ? 'almost none' : `only about ${fmt(online.sold)}`} would sell by then; the rest would go to the jobber on ${by} anyway.`);
      const costs = `AED ${fmt(online.holding)} of holding costs${online.adCost > 0.5 ? ` and AED ${fmt(online.adCost)} of ads` : ''}`;
      add('Expect', `The jobber pays AED ${fmt(jobber)} today (AED ${fmt(jobberPair)} a pair, ${jobberRule}). Waiting recovers only AED ${fmt(online.value)} by ${by} after ${costs}, so exiting now is worth AED ${fmt(jobber - online.value)} more.`);
      add('Note', `Can't be undone: all ${fmt(l.unitsLeft)} pairs leave stock today and their holding costs stop.`);
      return out;
    }
    case 'price':
    case 'price_ads': {
      const up = toPrice > l.price;
      const step = `${up ? '+' : '−'}AED ${fmt(Math.abs(toPrice - l.price))} a pair`;
      if (forced) add('Why', `Rule: Noon must stay within ±5% of the Amazon price, which also changes today. ${standing}: ${pace}.`);
      else if (up) add('Why', `${standing}: ${pace}. It can sell slower and still clear, so each pair can earn more.`);
      else if (lowConv && !lowSessions) add('Why', `Price is the blocker: ${fmt(e.sessionsPerDay)} visits a day, but only ${conv} buy (typical listing: ${pct(peers.conversion)}).${atToday}`);
      else add('Why', `${standing}: ${pace}.${atToday || ' A lower price clears it sooner and cuts holding costs.'}`);
      add('Expect', up
        ? `At AED ${fmt(toPrice)} (${step}) expect about ${one(final.pace)}/day (now ${one(e.recentPace)})${clear ? `, still clearing all ${fmt(l.unitsLeft)} by ${clear}` : `; ${fmt(final.sold)} of ${fmt(l.unitsLeft)} sell by ${by}`}.`
        : `At AED ${fmt(toPrice)} (${step}) expect about ${one(final.pace)}/day (now ${one(e.recentPace)}): ${more} more pairs sell online${toJobber}${ending}.`);
      if (kind === 'price_ads') add('Ads', toAd > l.adSpendPerDay ? adUp : `${adCut()} Saves AED ${fmt(adDiff)}/day.`);
      const notes: string[] = [];
      if (e.elasticitySource !== 'own')
        notes.push(up
          ? "This listing's price response isn't measured yet; tomorrow's sales will show if the raise slows it more than expected."
          : `This listing's price response isn't measured yet, so the cut is kept to ${Math.round(-s.smallStepLimit * 100)}% or less.`);
      if (Math.abs(toPrice - l.floor) < 0.5) notes.push("This is the floor; it can't go lower.");
      else if (toPrice < l.unitCost) notes.push(`Below cost (AED ${fmt(l.unitCost)}) but above the floor: each pair still brings in more than the jobber's AED ${fmt(jobberPair)}.`);
      add('Note', notes.join(' '));
      return out;
    }
    case 'ads':
      if (toAd > l.adSpendPerDay) {
        add('Why', lowSessions && !lowConv
          ? `Visibility is the blocker: ${fmt(e.sessionsPerDay)} visits a day vs ${fmt(peers.sessions)} for a typical listing, yet ${conv} of visitors buy.${atToday}`
          : `${standing}: ${pace}.${atToday || ' Ads here bring in more than they cost.'}`);
        add('Expect', `${adUp} That's ${more} more pairs sold online by ${by}${toJobber}${clear ? `, clearing by ${clear}` : ''}.`);
      } else {
        add('Why', adCut());
        add('Expect', `Saves AED ${fmt(adDiff)}/day. Expect about ${one(final.pace)}/day (now ${one(e.recentPace)})${ending}.`);
      }
      return out;
    default:
      add('Why', status === 'on_track'
        ? `${standing}: ${pace}. No change needed today.`
        : status === 'ahead'
          ? `${standing}: ${pace}. Price stays put to save the ${s.maxPriceChangesPer7d} price changes a week${l.adSpendPerDay > 0 ? ', and its ads still pay back' : ''}.`
          : canChangePrice(l, effectiveDate(state.today), s)
            ? `${standing}: ${pace}. Current price and ads already give the best result.`
            : `Price locked: ${s.maxPriceChangesPer7d} changes in the last 7 days.`);
      return out;
  }
}
