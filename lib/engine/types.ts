import type { Settings } from '../config';

export type Channel = 'amazon' | 'noon';
export const CHANNELS: Channel[] = ['amazon', 'noon'];

export type Listing = {
  id: string; // `${styleId}|${channel}`
  styleId: string;
  styleName: string;
  channel: Channel;
  unitCost: number; // AED, unit-weighted across sizes
  unitsStart: number;
  unitsLeft: number;
  floor: number; // liquidation floor, per style (may be below cost)
  mrp: number; // reference only
  price: number; // current selling price
  adSpendPerDay: number; // current AED/day
  priceChangeDates: string[]; // dates a new price took effect
  delisted: boolean; // exited to jobber
  jobberUnits: number;
  jobberValue: number;
};

export type DayRow = {
  date: string;
  listingId: string;
  price: number;
  sessions: number;
  adSpend: number;
  adClicks: number;
  unitsSold: number;
};

export type Estimate = {
  basePace: number; // units/day at p0 with no ads
  p0: number;
  elasticity: number;
  elasticitySource: 'prior' | 'pooled' | 'own';
  conversion: number; // units / sessions
  cpc: number; // AED per click
  adMultiplier: number; // learned correction on ad lift, starts at 1
  recentPace: number; // actual units/day incl. ads
  sessionsPerDay: number;
  dailyCv: number; // noise in daily units
};

export type ActionKind = 'keep' | 'price' | 'ads' | 'price_ads' | 'jobber';
export type Status = 'ahead' | 'on_track' | 'behind' | 'cleared' | 'exited';
export type Confidence = 'low' | 'med' | 'high';

export type Action = {
  id: string;
  listingId: string;
  styleId: string;
  styleName: string;
  channel: Channel;
  kind: ActionKind;
  fromPrice: number;
  toPrice: number;
  fromAd: number;
  toAd: number;
  predictedPace: number;
  projectedValue: number;
  keepValue: number;
  gainVsKeep: number;
  unitsLeft: number;
  unitsLeftAtDeadline: number;
  unitCost: number; // fixed for the listing
  floor: number; // fixed: liquidation floor for the style
  mrp: number; // fixed: original MRP for the style
  priceChangesLeft: number; // under the 2-in-7-days rule, for a change taking effect tomorrow
  status: Status;
  neededPace: number;
  actualPace: number;
  confidence: Confidence;
  explain: ExplainLine[]; // why this listing, what to expect, caveats
  applied: boolean;
};

export type ExplainLine = { label: 'Why' | 'Expect' | 'Ads' | 'Note'; text: string };

export type Prediction = {
  listingId: string;
  forDate: string;
  kind: ActionKind;
  fromPrice: number;
  toPrice: number;
  toAd: number;
  basePace: number;
  elasticity: number;
  adUnits: number;
  predictedUnits: number;
  actualUnits?: number;
  note?: string;
};

export type State = {
  version: 1;
  startDate: string; // last history day at load
  today: string; // last day with data
  deadline: string;
  listings: Listing[];
  history: DayRow[];
  estimates: Record<string, Estimate>;
  pooledElasticity: Record<Channel, number>;
  applied: Record<string, Action>; // today's applied actions, by listing id
  predictions: Prediction[];
  settings: Settings;
  warnings: string[];
  note?: { key: string; lines: string[]; model: string }; // last morning note, reused while the numbers are unchanged
};

export type Headline = {
  today: string;
  deadline: string;
  daysLeft: number;
  unitsLeft: number;
  unitsLeftAtDeadline: number;
  jobberValueAtDeadline: number;
  projectedRecovery: number;
  keepRecovery: number;
  alreadyRecoveredJobber: number;
  adBudgetPlanned: Record<Channel, number>;
  adBudgetCurrent: Record<Channel, number>;
  adBudget: Record<Channel, number>;
};

export type Violation = { rule: 'floor' | 'parity' | 'change_limit' | 'ad_budget' | 'stock'; key: string; detail: string };
