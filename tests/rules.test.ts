import { describe, it, expect } from 'vitest';
import { checkAllRules, canChangePrice, parityOk } from '../lib/engine/rules';
import { DEFAULT_SETTINGS as S } from '../lib/config';
import type { Listing } from '../lib/engine/types';

const mk = (o: Partial<Listing>): Listing => ({
  id: 'ST01|amazon', styleId: 'ST01', styleName: 'x', channel: 'amazon', unitCost: 100, unitsStart: 50, unitsLeft: 50,
  floor: 80, mrp: 300, price: 150, adSpendPerDay: 0, priceChangeDates: [], delisted: false, jobberUnits: 0, jobberValue: 0, ...o,
});

describe('rule gate', () => {
  it('flags a price below the floor', () => {
    expect(checkAllRules([mk({ price: 79 })], S).map((v) => v.rule)).toContain('floor');
  });
  it('parity: Noon 8% above Amazon fails, 5% passes', () => {
    expect(parityOk(100, 108, S)).toBe(false);
    expect(parityOk(100, 105, S)).toBe(true);
    const v = checkAllRules([mk({}), mk({ id: 'ST01|noon', channel: 'noon', price: 162 })], S);
    expect(v.map((x) => x.rule)).toContain('parity');
  });
  it('a third price change inside 7 days is not allowed', () => {
    const l = mk({ priceChangeDates: ['2026-10-01', '2026-10-03'] });
    expect(canChangePrice(l, '2026-10-05', S)).toBe(false);
    expect(canChangePrice(l, '2026-10-08', S)).toBe(true); // 10-01 has rolled out of the window
    expect(checkAllRules([mk({ priceChangeDates: ['2026-10-01', '2026-10-03', '2026-10-05'] })], S).map((v) => v.rule)).toContain('change_limit');
  });
  it('channel ad budget is a total across listings', () => {
    const ls = Array.from({ length: 11 }, (_, i) => mk({ id: `S${i}|noon`, styleId: `S${i}`, channel: 'noon', adSpendPerDay: 100 }));
    expect(checkAllRules(ls, S).map((v) => v.rule)).toContain('ad_budget'); // 1,100 > 1,000
  });
  it('no ads on zero stock', () => {
    expect(checkAllRules([mk({ unitsLeft: 0, adSpendPerDay: 20 })], S).map((v) => v.rule)).toContain('stock');
  });
});
