export const aed = (n: number) => 'AED ' + Math.round(n).toLocaleString('en-US');
export const int = (n: number) => Math.round(n).toLocaleString('en-US');
export const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
export const day = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const channel = (c: string) => (c === 'amazon' ? 'Amazon' : 'Noon');
