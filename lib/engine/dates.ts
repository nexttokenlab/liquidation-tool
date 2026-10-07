const DAY = 86_400_000;
export const toMs = (d: string) => Date.parse(d + 'T00:00:00Z');
export const addDays = (d: string, n: number) => new Date(toMs(d) + n * DAY).toISOString().slice(0, 10);
export const diffDays = (a: string, b: string) => Math.round((toMs(a) - toMs(b)) / DAY); // a - b
export const fmtDay = (d: string) =>
  new Date(toMs(d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
