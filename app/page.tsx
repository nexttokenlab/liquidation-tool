'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Action, Headline } from '@/lib/engine/types';
import ActionTable from '@/components/ActionTable';
import { aed, day, int } from '@/components/format';

type Recs = { loaded: false } | { loaded: true; actions: Action[]; headline: Headline; warnings: string[]; startDate: string };

function Meter({ label, used, cap }: { label: string; used: number; cap: number }) {
  return (
    <div className="meter">
      <div className="label"><span>{label} ads</span><span>{aed(used)} of {int(cap)}/day</span></div>
      <div className="bar"><span style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} /></div>
    </div>
  );
}

export default function Today() {
  const [data, setData] = useState<Recs | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [note, setNote] = useState<{ lines?: string[]; reason?: string; model?: string } | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch('/api/recommendations', { cache: 'no-store' });
    setData(await r.json());
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // The morning note writes itself once the plan loads; the server reuses it while the numbers are unchanged.
  const autoNote = useRef(false);
  useEffect(() => {
    if (data?.loaded && !autoNote.current) { autoNote.current = true; writeNote(); }
  }, [data]);

  async function apply(listingId: string) {
    setBusy(listingId);
    const r = await fetch('/api/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ listingId }) });
    const j = await r.json();
    setBusy(null);
    setMsg(r.ok ? { text: j.note ?? 'Applied. The prediction is logged and will be checked against tomorrow’s sales.' } : { text: j.error, error: true });
    await refresh();
  }

  async function writeNote(fresh = false) {
    setBusy('note');
    const r = await fetch('/api/summary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fresh }) });
    const j = await r.json();
    setBusy(null);
    setNote(j.ok ? { lines: j.lines, model: j.model } : { reason: j.reason ?? j.error });
  }

  if (!data) return <p className="muted">Loading…</p>;
  if (!data.loaded)
    return (
      <div className="empty">
        <h1>No stock loaded yet</h1>
        <p>Load inventory, constraints and daily history to get today’s actions. Sample files are bundled if you just want to try it.</p>
        <Link className="btn primary" href="/upload">Load data</Link>
      </div>
    );

  const h = data.headline;
  const gain = h.projectedRecovery - h.keepRecovery;
  const appliedCount = data.actions.filter((a) => a.applied).length;
  return (
    <>
      <section className="hero">
        <h1>{h.daysLeft > 0 ? `${h.daysLeft} days to clear ${int(h.unitsLeft)} pairs.` : 'The 60-day window has closed.'}</h1>
        <p className="plan">
          On today’s plan, <strong>{int(h.unitsLeftAtDeadline)} pairs</strong> go to the jobber on {day(h.deadline)} for {aed(h.jobberValueAtDeadline)}, and
          the remaining stock recovers <strong>{aed(h.projectedRecovery)}</strong>.
          {gain > 1 && <> That is {aed(gain)} more than changing nothing.</>}
        </p>
        <div className="meta">
          <span>Data through {day(h.today)}</span>
          <Meter label="Amazon" used={h.adBudgetPlanned.amazon} cap={h.adBudget.amazon} />
          <Meter label="Noon" used={h.adBudgetPlanned.noon} cap={h.adBudget.noon} />
          <div className="row-actions" style={{ marginLeft: 'auto' }}>
            <Link className="btn" href="/upload">Add a day’s data</Link>
          </div>
        </div>
      </section>

      {msg && <div className={`notice ${msg.error ? 'error' : ''}`} role="status">{msg.text}</div>}

      <div className="panel">
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <h2>Morning note</h2>
          <span className="sub" style={{ margin: 0 }}>Written by an LLM from the numbers below; every number is checked before it is shown.</span>
          <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => writeNote(true)} disabled={!!busy}>
            {busy === 'note' ? 'Writing…' : 'Rewrite note'}
          </button>
        </div>
        {!note && busy === 'note' && <p className="muted" style={{ marginTop: 10 }}>Writing this morning’s note…</p>}
        {note?.lines && <div className="note-lines" style={{ marginTop: 10 }}>{note.lines.map((l, i) => <p key={i}>{l}</p>)}</div>}
        {note?.reason && <p className="muted" style={{ marginTop: 10 }}>{note.reason} The table below has every number.</p>}
      </div>

      {data.warnings.length > 0 && appliedCount === 0 && (
        <details className="panel"><summary>{data.warnings.length} data notes from loading</summary>
          <ul className="warn-list">{data.warnings.slice(0, 12).map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}

      <ActionTable actions={data.actions} onApply={apply} busy={busy} />
    </>
  );
}
