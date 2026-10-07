'use client';
import { useEffect, useState } from 'react';
import type { Prediction } from '@/lib/engine/types';
import { channel, day } from '@/components/format';

type Log = { loaded: boolean; predictions: (Prediction & { change?: string })[]; pooled?: { amazon: number; noon: number } };
const KIND: Record<string, string> = { price: 'Price change', ads: 'Ad change', price_ads: 'Price and ads', keep: 'Keep' };

export default function LearningLog() {
  const [log, setLog] = useState<Log | null>(null);
  useEffect(() => { fetch('/api/log', { cache: 'no-store' }).then((r) => r.json()).then(setLog); }, []);
  if (!log) return <p className="muted">Loading…</p>;
  const checked = log.predictions.filter((p) => p.actualUnits !== undefined);
  const mae = checked.length ? checked.reduce((a, p) => a + Math.abs(p.predictedUnits - (p.actualUnits ?? 0)), 0) / checked.length : null;
  return (
    <>
      <section className="hero">
        <h1>Learning log</h1>
        <p className="plan">
          Every applied action records what it expected to sell the next day. When that day’s data arrives, the
          prediction is checked first and the estimates move partway toward reality before anything is re-scored.
        </p>
        <div className="meta">
          <span>{log.predictions.length} predictions logged, {checked.length} checked</span>
          {mae !== null && <span>Average miss {mae.toFixed(2)} pairs/day</span>}
          {log.pooled && <span>Pooled price response: Amazon {log.pooled.amazon.toFixed(2)}, Noon {log.pooled.noon.toFixed(2)}</span>}
        </div>
      </section>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Day</th><th>Listing</th><th>Action</th><th className="num">Predicted pairs</th><th className="num">Actual</th><th className="num">Miss</th></tr></thead>
          <tbody>
            {log.predictions.map((p, i) => {
              const [style, ch] = p.listingId.split('|');
              const miss = p.actualUnits === undefined ? null : p.actualUnits - p.predictedUnits;
              return (
                <tr key={i}>
                  <td>{day(p.forDate)}</td>
                  <td>{style}<span className="chan">{channel(ch)}</span></td>
                  <td>{KIND[p.kind] ?? p.kind}{p.toPrice !== p.fromPrice && <span className="muted"> AED {Math.round(p.fromPrice)} → {Math.round(p.toPrice)}</span>}</td>
                  <td className="num">{p.predictedUnits.toFixed(1)}</td>
                  <td className="num">{p.actualUnits ?? <span className="muted">waiting</span>}</td>
                  <td className={`num ${miss !== null && Math.abs(miss) > 1 ? 'neg' : ''}`}>{miss === null ? '' : (miss > 0 ? '+' : '') + miss.toFixed(1)}</td>
                </tr>
              );
            })}
            {!log.predictions.length && <tr><td colSpan={6} className="muted">No predictions yet. Apply an action on the Today page, then add the next day’s data.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
