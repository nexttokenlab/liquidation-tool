'use client';
import { useMemo, useState } from 'react';
import type { Action } from '@/lib/engine/types';
import { DEFAULT_SETTINGS } from '@/lib/config';
import { aed, channel, int, one } from './format';

const STATUS: Record<Action['status'], string> = { ahead: 'Ahead', on_track: 'On track', behind: 'Behind', cleared: 'Sold out', exited: 'Exited' };

// Small line icons; stroke follows the text colour.
const ICONS = {
  tag: <><path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" /><circle cx="7.5" cy="7.5" r="1" fill="currentColor" /></>,
  ads: <><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>,
  adsOff: <><path d="M9.3 9.3 3 11v3l14.1 3.1" /><path d="M21 15.3V6l-7.3 2" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /><path d="m2 2 20 20" /></>,
  truck: <><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M15 18H9" /><path d="M19 18h2a1 1 0 0 0 1-1v-3.6a1 1 0 0 0-.2-.6l-3.5-4.4a1 1 0 0 0-.8-.4H14" /><circle cx="17" cy="18" r="2" /><circle cx="7" cy="18" r="2" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  up: <path d="M12 19V5m-6 6 6-6 6 6" />,
  down: <path d="M12 5v14m-6-6 6 6 6-6" />,
  right: <path d="M5 12h14m-6-6 6 6-6 6" />,
};
const Svg = ({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
);
const Icon = ({ name }: { name: keyof typeof ICONS }) => <span className="ico"><Svg name={name} /></span>;

// One line per move: what to do, old value struck through, new value.
const Arrow = () => <span className="arrow"><Svg name="right" size={14} /></span>;

function PriceMove({ a }: { a: Action }) {
  const up = a.toPrice > a.fromPrice;
  const pct = Math.abs(((a.toPrice - a.fromPrice) / a.fromPrice) * 100);
  return (
    <div className={`move price ${up ? 'up' : 'down'}`}>
      <Icon name="tag" />
      <div className="line">
        <span className="verb">{up ? 'Raise' : 'Cut'} price</span>
        <s className="tag old">AED {int(a.fromPrice)}</s>
        <Arrow />
        <span className="tag new">AED {int(a.toPrice)}</span>
        <span className="delta"><Svg name={up ? 'up' : 'down'} size={12} />{pct < 1 ? '<1' : Math.round(pct)}%</span>
      </div>
    </div>
  );
}

function AdMove({ a }: { a: Action }) {
  const stop = a.toAd === 0, up = a.toAd > a.fromAd;
  return (
    <div className={`move ads ${stop ? 'stop' : up ? 'up' : 'down'}`}>
      <Icon name={stop ? 'adsOff' : 'ads'} />
      <div className="line">
        <span className="verb">{stop ? 'Stop ads' : up ? 'Increase ads' : 'Reduce ads'}</span>
        <s className="chip old">AED {int(a.fromAd)}</s>
        <Arrow />
        <span className="chip new">AED {int(a.toAd)}/day</span>
      </div>
    </div>
  );
}

function DoThis({ a }: { a: Action }) {
  if (a.kind === 'jobber') return (
    <div className="moves">
      <div className="move jobber">
        <Icon name="truck" />
        <div className="line">
          <span className="verb">Send {int(a.unitsLeft)} pairs to the jobber</span>
          <span className="chip new">{aed(a.projectedValue)} now</span>
        </div>
      </div>
    </div>
  );
  const price = a.kind === 'price' || a.kind === 'price_ads';
  const ads = a.kind === 'ads' || a.kind === 'price_ads';
  if (!price && !ads) return <div className="moves"><div className="move keep"><Icon name="check" /><div className="line"><span className="verb">No change</span></div></div></div>;
  return <div className="moves">{price && <PriceMove a={a} />}{ads && <AdMove a={a} />}</div>;
}

// Why / Expect / Ads / Note, each on its own labelled line, folded away until asked for
// so the table stays a list of decisions.
function Explain({ a }: { a: Action }) {
  if (!a.explain?.length) return null;
  return (
    <details className="why-toggle">
      <summary><span className="show">Why?</span><span className="hide">Hide why</span></summary>
      <dl className="why">
        {a.explain.map((x) => (
          <div key={x.label} className={x.label.toLowerCase()}><dt>{x.label}</dt><dd>{x.text}</dd></div>
        ))}
      </dl>
    </details>
  );
}

// Fixed facts, per pair: part of what the listing is, so they read quietly with its name.
// Two pairs: what a pair cost and what the jobber pays for it; the price ceiling and floor.
const jobberRule = Number.isInteger(1 / DEFAULT_SETTINGS.jobberRate)
  ? `cost ÷ ${1 / DEFAULT_SETTINGS.jobberRate}`
  : `${DEFAULT_SETTINGS.jobberRate * 100}% of cost`;

function Facts({ a }: { a: Action }) {
  return (
    <>
      <dl className="facts">
        <div><dt>Cost</dt><dd>AED {int(a.unitCost)}</dd></div>
        <div><dt>Jobber</dt><dd>AED {int(a.unitCost * DEFAULT_SETTINGS.jobberRate)} <span className="rule">({jobberRule})</span></dd></div>
      </dl>
      <dl className="facts">
        <div><dt>MRP</dt><dd>AED {int(a.mrp)}</dd></div>
        <div><dt>Floor</dt><dd>AED {int(a.floor)}</dd></div>
      </dl>
    </>
  );
}

// Live state that moves day to day, before today's action (a price change takes effect tomorrow).
function Now({ a }: { a: Action }) {
  return (
    <>
      <dl className="now">
        <div><dt>Stock now</dt><dd>{int(a.unitsLeft)}</dd></div>
        <div><dt>Price now</dt><dd>AED {int(a.fromPrice)}</dd></div>
        <div><dt>Ads now</dt><dd className={a.fromAd > 0 ? '' : 'off'}>{a.fromAd > 0 ? `AED ${int(a.fromAd)}/day` : 'None'}</dd></div>
      </dl>
      {a.priceChangesLeft < DEFAULT_SETTINGS.maxPriceChangesPer7d && (
        <div className="lock">
          <Svg name="lock" size={12} />
          {a.priceChangesLeft === 0 ? 'Price locked (2 changes in 7 days)' : `${a.priceChangesLeft} price change left (2 per 7 days)`}
        </div>
      )}
    </>
  );
}

// Applied rows always sink to the bottom; ties fall back to money gained.
const SORTS = {
  gain: { label: 'Gain', note: 'money gained', cmp: (x: Action, y: Action) => y.gainVsKeep - x.gainVsKeep },
  inventory: { label: 'Inventory', note: 'pairs in stock', cmp: (x: Action, y: Action) => y.unitsLeft - x.unitsLeft || y.gainVsKeep - x.gainVsKeep },
  // Style ID (ST2 before ST10); a style's two channels sit together, Amazon first.
  listing: { label: 'Listing', note: 'style ID', cmp: (x: Action, y: Action) =>
    x.styleId.localeCompare(y.styleId, undefined, { numeric: true }) || x.channel.localeCompare(y.channel) },
};
type SortKey = keyof typeof SORTS;

export default function ActionTable({ actions, onApply, busy }: { actions: Action[]; onApply: (id: string) => void; busy: string | null }) {
  const [ch, setCh] = useState<'all' | 'amazon' | 'noon'>('all');
  const [hideKeep, setHideKeep] = useState(true);
  const [sort, setSort] = useState<SortKey>('gain');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () => actions
      .filter((a) => ch === 'all' || a.channel === ch)
      // A search looks for a specific listing, so it also finds ones with no change.
      .filter((a) => q
        ? `${a.styleName} ${a.styleId} ${channel(a.channel)}`.toLowerCase().includes(q)
        : !hideKeep || a.kind !== 'keep' || a.applied)
      .sort((x, y) => Number(x.applied) - Number(y.applied) || SORTS[sort].cmp(x, y)),
    [actions, ch, hideKeep, sort, q],
  );
  const pending = actions.filter((a) => !a.applied && a.kind !== 'keep').length;
  return (
    <section>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Channel">
          {(['all', 'amazon', 'noon'] as const).map((c) => (
            <button key={c} aria-pressed={ch === c} onClick={() => setCh(c)}>{c === 'all' ? 'Both channels' : channel(c)}</button>
          ))}
        </div>
        <span className="sort-group">
          <span className="muted sort-label">Sort</span>
          <div className="seg" role="group" aria-label="Sort by">
            {(Object.keys(SORTS) as SortKey[]).map((k) => (
              <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>{SORTS[k].label}</button>
            ))}
          </div>
        </span>
        <input
          type="search" className="search" placeholder="Search style, ID or channel"
          aria-label="Search listings" value={query} onChange={(e) => setQuery(e.target.value)}
        />
        <label><input type="checkbox" checked={hideKeep} disabled={!!q} onChange={(e) => setHideKeep(e.target.checked)} /> Hide listings with no change</label>
        <span className="muted" style={{ marginLeft: 'auto' }}>{pending} actions to review, sorted by {SORTS[sort].note}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Listing</th><th>Pace</th><th>Do this</th><th className="num">Gain vs no change</th>
              <th className="num">Left on day 60</th><th>Confidence</th><th aria-label="Apply" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.listingId} className={a.applied ? 'applied' : ''}>
                <td className="listing"><b>{a.styleName}</b><span>{a.styleId}</span><span className="chan">{channel(a.channel)}</span><Facts a={a} /><Now a={a} /></td>
                <td>
                  <span className={`status ${a.status}`}>{STATUS[a.status]}</span>
                  {a.status !== 'cleared' && a.status !== 'exited' && <span className="pace">{one(a.actualPace)}/day, needs {one(a.neededPace)}</span>}
                </td>
                <td><DoThis a={a} /><Explain a={a} /></td>
                <td className={`num gain ${a.gainVsKeep > 0.5 ? 'pos' : ''}`}>{a.gainVsKeep > 0.5 ? '+' + aed(a.gainVsKeep) : '—'}</td>
                <td className="num">{int(a.unitsLeftAtDeadline)} <span className="muted">of {int(a.unitsLeft)}</span></td>
                <td className="conf">{a.kind === 'keep' ? '' : a.confidence}</td>
                <td className="num">
                  {a.applied ? <span className="muted">Applied ✓</span>
                    : a.kind === 'keep' ? null
                    : <button className="btn primary small" disabled={!!busy} onClick={() => onApply(a.listingId)}>{busy === a.listingId ? 'Applying…' : 'Apply'}</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="muted">{q ? `No listing matches “${query.trim()}”.` : 'Nothing to change for this filter.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
