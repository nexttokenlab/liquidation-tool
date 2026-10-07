import { describe, it, expect } from 'vitest';
import { moneyRecovered, jobberNowValue } from '../lib/engine/score';

// The worked example from the approach note: 100 units, 60 days, cost 100, jobber 25/unit.
const base = { stock: 100, daysLeft: 60, unitCost: 100, holdingPerUnitPerDay: 0, jobberRate: 0.25, feeRate: 0 };

describe('money recovered by the deadline', () => {
  it('keep at 180, 1/day: 60 sold online + 40 to the jobber = 11,800', () => {
    expect(moneyRecovered(1, { ...base, price: 180, adPerDay: 0 }).value).toBeCloseTo(11_800);
  });
  it('cut to 150, 2/day: stock runs out on day 50, all 100 sold = 15,000', () => {
    expect(moneyRecovered(2, { ...base, price: 150, adPerDay: 0 }).value).toBeCloseTo(15_000);
  });
  it('keep 180 + AED 20/day ads, 2/day: ads stop on day 50 = 18,000 - 1,000 = 17,000', () => {
    expect(moneyRecovered(2, { ...base, price: 180, adPerDay: 20 }).value).toBeCloseTo(17_000);
  });
  it('holding cost is charged on stock actually held', () => {
    const r = moneyRecovered(0, { ...base, price: 180, adPerDay: 0, holdingPerUnitPerDay: 0.1 });
    expect(r.holding).toBeCloseTo(100 * 60 * 0.1); // nothing sells, all 100 held 60 days
    expect(r.value).toBeCloseTo(2_500 - 600);
  });
  it('jobber now = 25% of cost per unit', () => {
    expect(jobberNowValue(100, 100, 0.25)).toBe(2_500);
  });
});
