import { describe, it, expect } from 'vitest';
import { verifyNumbers } from '../lib/llm/summary';

describe('LLM number verification', () => {
  const payload = { projected_recovery_aed: 584362, days_left: 60, top_actions: [{ style: 'ST05', gain_aed: 6019 }] };
  it('accepts numbers taken from the payload, with separators', () => {
    expect(verifyNumbers('60 days left; AED 584,362 projected. Start with ST05 (+AED 6,019).', payload).ok).toBe(true);
  });
  it('rejects an invented or rounded number', () => {
    const r = verifyNumbers('About AED 584,000 projected.', payload);
    expect(r.ok).toBe(false);
    expect(r.bad).toContain(584000);
  });
});
