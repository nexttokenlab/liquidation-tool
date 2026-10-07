'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Result = { kind: 'ok' | 'error'; text: string; details?: string[] };

export default function Upload() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [paste, setPaste] = useState('');

  async function post(url: string, body: FormData | string, label: string) {
    setBusy(label); setRes(null);
    const r = await fetch(url, { method: 'POST', body, headers: typeof body === 'string' ? { 'content-type': 'application/json' } : undefined });
    const j = await r.json();
    setBusy(null);
    if (!r.ok) { setRes({ kind: 'error', text: j.error }); return null; }
    return j;
  }

  async function loadFiles(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const j = await post('/api/load', new FormData(e.currentTarget), 'files');
    if (j) setRes({ kind: 'ok', text: `Loaded ${j.listings} listings. Today is ${j.today}; the deadline is ${j.deadline}.`, details: j.warnings });
  }
  async function loadSample() {
    const j = await post('/api/load', JSON.stringify({ useSample: true }), 'sample');
    if (j) router.push('/');
  }
  async function addDayFile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const j = await post('/api/day', new FormData(e.currentTarget), 'dayfile');
    if (j) setRes({ kind: 'ok', text: `Added data through ${j.today}. Checked ${j.learned.length} predictions and re-scored every listing.`, details: j.warnings });
  }
  async function addDayPaste() {
    const j = await post('/api/day', JSON.stringify({ history: paste }), 'paste');
    if (j) { setPaste(''); setRes({ kind: 'ok', text: `Added data through ${j.today}. Checked ${j.learned.length} predictions and re-scored every listing.`, details: j.warnings }); }
  }
  async function reset() {
    if (!confirm('Clear all loaded data, applied actions and the learning log?')) return;
    await post('/api/reset', '{}', 'reset');
    setRes({ kind: 'ok', text: 'Cleared. Load files to start again.' });
  }

  return (
    <>
      <section className="hero">
        <h1>Data</h1>
        <p className="plan">Load the three starting files once. After that, add each new day’s history rows; stock is worked out from what sold.</p>
      </section>
      {res && (
        <div className={`notice ${res.kind === 'error' ? 'error' : ''}`} role="status">
          {res.text}
          {res.details && res.details.length > 0 && <ul className="warn-list">{res.details.slice(0, 10).map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}
      <div className="grid2">
        <form className="panel" onSubmit={loadFiles}>
          <h2>Start: three files</h2>
          <p className="sub">Column names can vary; common variants are matched and every value is validated.</p>
          <div className="field"><label htmlFor="inv">inventory.csv</label><input id="inv" name="inventory" type="file" accept=".csv,text/csv" required /></div>
          <div className="field"><label htmlFor="con">constraints.csv</label><input id="con" name="constraints" type="file" accept=".csv,text/csv" required /></div>
          <div className="field"><label htmlFor="his">daily_history.csv</label><input id="his" name="history" type="file" accept=".csv,text/csv" required /></div>
          <div className="row-actions">
            <button className="btn primary" disabled={!!busy}>{busy === 'files' ? 'Loading…' : 'Load files'}</button>
            <button type="button" className="btn" onClick={loadSample} disabled={!!busy}>{busy === 'sample' ? 'Loading…' : 'Use sample data'}</button>
          </div>
        </form>
        <div className="panel">
          <h2>Add a new day</h2>
          <p className="sub">Same columns as daily_history.csv. One or more days; rows on or before the current day are ignored.</p>
          <form onSubmit={addDayFile} className="field">
            <input name="history" type="file" accept=".csv,text/csv" required />{' '}
            <button className="btn primary small" disabled={!!busy}>{busy === 'dayfile' ? 'Adding…' : 'Add file'}</button>
          </form>
          <div className="field">
            <label htmlFor="paste">Or paste rows, header included</label>
            <textarea id="paste" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'date,style_id,channel,price_aed,sessions,ad_spend_aed,ad_clicks,units_sold\n2026-10-05,ST01,Amazon.ae,137,30,0,0,1'} />
          </div>
          <button className="btn primary small" onClick={addDayPaste} disabled={!!busy || !paste.trim()}>{busy === 'paste' ? 'Adding…' : 'Add pasted rows'}</button>
        </div>
      </div>
      <p style={{ marginTop: 8 }}><button className="btn small" onClick={reset} disabled={!!busy}>Clear everything</button></p>
    </>
  );
}
