# Clearance desk: liquidation run-rate prototype

Tells Farah (Brand Manager GCC, Stride & Co.) what to do today with each of 40 listings
(20 styles × Amazon.ae and Noon) to **maximise money recovered by day 60**, never breaking a
business rule. Selling everything is not the goal: the jobber guarantees 25% of cost on any unit,
so the tool sells online only while that beats the jobber.

## Run locally

Needs Node.js 22 or newer and npm.

1. `git clone https://github.com/nexttokenlab/liquidation-copilot.git && cd liquidation-copilot && npm install`
2. Optional, for the morning note: `cp .env.example .env.local` and add a `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`).
   Without a key everything else works and the note shows the table instead.
3. `npm run dev`, open http://localhost:3000, go to **Data** and click **Use sample data** (or load your three CSVs).

Port 3000 busy? `npm run dev -- -p 3001`. To start over, use **Clear everything** on the Data page.

Tests: `npm test`. This includes a simulator that runs 40 random worlds for 10 days each, applies every recommendation,
and asserts zero rule breaks after each step.

Every business rule (ad budgets, price-change limit, parity band, holding cost, jobber rate, horizon) lives in `lib/config.ts`.

## The Today screen

Built so Farah can act within 60 seconds:

- **Headline:** days left, pairs left, how many pairs go to the jobber on the deadline on today's plan, money recovered, and
  the gain over changing nothing. Ad budget used per channel.
- **Morning note:** three lines written by the LLM when the page opens (see step 7 below).
- **One row per listing that needs action**, sorted by money gained (or by stock, or by style ID), with search and a channel filter.
  - *Fixed facts* sit quietly under the name: cost with the jobber price (cost ÷ 4), MRP with the floor.
  - *Live state* sits in a tinted panel: stock, price and ad spend now, plus a lock note when the 7-day price-change limit applies.
  - *The action* is one line: what to do, the old value struck through, the new value (e.g. Cut price ~~AED 191~~ → AED 181 ▼5%).
  - *Why?* opens the explanation: Why (the reason, with numbers), Expect (what should happen), Ads, Note (caveats).
  - *Apply* records the change; a jobber exit always needs its own click.
- **Add a day's data** (upload or paste) re-learns and re-scores everything.

## How a day works

1. **Load or add data.** CSV upload or paste. Headers are matched through an alias map; values are validated with zod.
   Sizes are summed to listing level. Stock after day 1 is derived from units sold.
2. **Learn first.** Yesterday's applied actions logged a prediction. The new rows are compared with it and the
   estimates move partway toward reality: price response by 30% of the gap, scaled down for small price moves; ad lift likewise.
   A pooled per-channel price response moves by 10%.
3. **Status.** Needed pace (units left ÷ days left) against the last 7 days' actual pace: Ahead, On track, Behind.
4. **Candidates.** Keep, price −5/−10/−20% or to floor (only ≤10% until a listing's price response is proven),
   +5% when ahead, ads 0/20/50/100/150 AED a day, or exit to the jobber now.
5. **Rule gate.** Price is chosen jointly for both channels of a style, so the Noon ±5% parity always holds. Also checked:
   floor, 2 price changes per rolling 7 days, per-channel daily ad budget (AED 1,500 Amazon, AED 1,000 Noon), no ads on zero stock.
   Apply re-checks the gate against the current state.
6. **Money.** For each legal candidate, project to the deadline:
   `price × units sold − ad spend while stock lasts − holding (AED 3/unit/month) + 25% × cost × leftover units`.
   Pick the best per style, then hand each channel's ad budget to the listings that return the most AED per AED spent.
7. **Explain.** Each action carries a code-written Why / Expect / Ads / Note built from the computed numbers, behind a
   **Why?** toggle so the table stays a list of decisions. One LLM call
   (Gemini, or Claude if only that key is set) writes a 3-line morning note when the page opens; it is reused until the numbers change.
   Every number in the reply is checked against the input; any mismatch, cut-off reply, timeout or missing key shows the table
   instead. The LLM never decides anything.

## What I cut

- **Learning is a feedback loop, not a fitted model.** Predictions are logged and nudged daily; there is no per-listing
  demand curve fitting, seasonality or confidence intervals. 14 days of history cannot support more.
- **No marketplace fees, returns, competitor prices or per-size pricing.** Fees and returns are not in the brief;
  `feeRate` exists in `lib/config.ts` and defaults to 0.
- **No sale events.** White Friday, Yellow Friday and UAE National Day fall inside the window and would change demand;
  not modelled.
- **LLM column mapping is designed, not built.** Messy headers are handled by an alias map. The planned version: the LLM proposes
  a mapping, code validates it, and Farah confirms only the ambiguous columns.
- **Single user, local JSON state** (`data/state.json`). No auth, no marketplace integration; Apply changes stored state only.

## Changes from the approach note

- **Per-action reasons are written by code, not the LLM.** The note had the LLM write a short reason for each action.
  Templates filled with the engine's numbers can't misstate a number, and 40 extra LLM calls a morning bought little.
  The LLM writes only the three-line morning note.
- **"Will we make it?" is a single projection, not a range.** Pairs left on 3 Dec and their jobber value are one number;
  a credible range needs more than 14 days of history (see "What I cut").
- **On-track listings are scored too.** The note left them alone. Every listing is scored the same way, so an On-track
  listing gets an action only when it recovers more money, most often stopping ads that only speed up sales it would make anyway.
- **Ahead listings can get a +5% price raise, not only less ad spend.** It is offered only when the extra margin outweighs
  the slower sales and the 7-day limit allows it; the lock state is shown on the listing.
- **Ad response starts at face value, not discounted.** With no ad-attributed sales in the data, any discount would be a guess,
  so ad clicks are assumed to convert like the listing's own visits. The daily learning step corrects this once applied ad
  changes are observed.
- **Jobber exits are whole-listing, not partial.** Exiting only the surplus would save holding cost on pairs that won't sell
  anyway; I kept each exit to one clear, irreversible click. The plan still shows how many pairs reach the jobber on 3 Dec.

## Assumptions to confirm

- A listing exited to the jobber is delisted, so parity no longer applies to its partner listing.
- Ad lift = (ad AED ÷ cost per click) × the listing's own conversion. Ad clicks are assumed to convert like organic sessions.
- A price change takes effect the day after Apply; past changes are read from the history for the 7-day rule.
- Prices are whole dirhams. A jobber exit is never applied implicitly; it always needs its own click.
- MRP only caps price raises. If `constraints.csv` has no MRP column, it defaults to 4 × the floor.

## Sample data

`data/sample/` holds synthetic files matching the brief's schema (20 styles, 560 history rows, 3,000 pairs today),
generated by `npm run sample` (seed 7, scaled to 3,000 pairs; `npx tsx scripts/generate-sample.ts <seed> <pairs>` for others)
from a hidden "true market" in `data/sample/truth.json`. The engine never reads that file; only the demo route
`POST /api/simulate` uses it, to produce realistic next-day rows (its **Simulate tomorrow** button is hidden for now).
Replace the CSVs with Opptra's files when they arrive.

## Layout

```
lib/engine/   pure decision logic: estimate, rules (the gate), score, index (recommend), apply, learn
lib/io/       CSV parsing + validation, JSON store, HTTP helpers
lib/llm/      morning note (Gemini or Claude) + number verification
lib/sim/      sample-data generator and next-day simulator (demo/test only)
app/          Next.js pages (Today, Data, Learning log) and API routes
components/   the Today table (ActionTable) and formatting helpers
tests/        money math, rule gate, LLM number check, random-world simulator
```
