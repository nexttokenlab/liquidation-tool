// The one LLM call. It only EXPLAINS numbers the engine already computed.
// Every number in its reply is checked against the input; any mismatch -> fallback.
import Anthropic from '@anthropic-ai/sdk';
import type { Action, Headline } from '../engine/types';

export type SummaryResult =
  | { ok: true; lines: string[]; model: string }
  | { ok: false; reason: string; rejected?: string };

const KIND: Record<Action['kind'], string> = { keep: 'keep', price: 'price change', ads: 'ad change', price_ads: 'price and ad change', jobber: 'exit to jobber' };

export function buildPayload(h: Headline, actions: Action[]) {
  const top = actions.filter((a) => !a.applied && a.kind !== 'keep').slice(0, 5);
  return {
    days_left: h.daysLeft,
    pairs_left_now: Math.round(h.unitsLeft),
    pairs_left_at_deadline_on_this_plan: Math.round(h.unitsLeftAtDeadline),
    projected_recovery_aed: Math.round(h.projectedRecovery),
    gain_vs_changing_nothing_aed: Math.round(h.projectedRecovery - h.keepRecovery),
    actions_to_take: actions.filter((a) => !a.applied && a.kind !== 'keep').length,
    top_actions: top.map((a) => ({
      style: a.styleId, name: a.styleName, channel: a.channel === 'amazon' ? 'Amazon' : 'Noon', action: KIND[a.kind],
      price_from: Math.round(a.fromPrice), price_to: Math.round(a.toPrice), ads_from: Math.round(a.fromAd), ads_to: Math.round(a.toAd),
      gain_aed: Math.round(a.gainVsKeep),
    })),
  };
}

const numbersIn = (text: string) =>
  (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ''))).filter((n) => Number.isFinite(n));

// Every number the model writes must appear in the payload (style codes like ST07 count).
export function verifyNumbers(text: string, payload: unknown) {
  const allowed = new Set(numbersIn(JSON.stringify(payload)));
  for (const n of [1, 2, 3, 5]) allowed.add(n); // list counts the model may naturally use
  const bad = numbersIn(text).filter((n) => !allowed.has(n));
  return { ok: bad.length === 0, bad };
}

const SYSTEM = `You write the morning note for Farah, a brand manager clearing last-season sneakers on Amazon.ae and Noon.
Write exactly 3 short lines, plain text, no bullets or numbering.
Line 1: where things stand. Line 2: the most valuable actions today. Line 3: what happens if she does nothing.
Use ONLY numbers that appear in the JSON, written exactly as they appear there (you may add thousands separators). Never compute, round or invent numbers. Say "AED" before money.`;

// Gemini over plain REST (no SDK). Rewording given numbers needs no reasoning, so Gemini 3
// thinking is set to minimal: default thinking used up the output cap and cut the note off.
async function callGemini(user: string) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.2, maxOutputTokens: 2048,
        ...(model.startsWith('gemini-3') && { thinkingConfig: { thinkingLevel: 'minimal' } }),
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
  const c = j.candidates?.[0];
  if (c?.finishReason !== 'STOP') throw new Error(`reply incomplete (${c?.finishReason ?? 'no candidate'})`);
  const parts: { text?: string; thought?: boolean }[] = c.content?.parts ?? [];
  return { text: parts.map((p) => (p.thought ? '' : p.text ?? '')).join(''), model };
}

async function callClaude(user: string) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  const res = await new Anthropic().messages.create({ model, max_tokens: 300, system: SYSTEM, messages: [{ role: 'user', content: user }] });
  return { text: res.content.map((b) => (b.type === 'text' ? b.text : '')).join(''), model };
}

// Gemini when GEMINI_API_KEY is set, otherwise Claude when ANTHROPIC_API_KEY is set.
export async function summarize(h: Headline, actions: Action[]): Promise<SummaryResult> {
  const useGemini = !!process.env.GEMINI_API_KEY;
  if (!useGemini && !process.env.ANTHROPIC_API_KEY) return { ok: false, reason: 'No GEMINI_API_KEY or ANTHROPIC_API_KEY set; showing the table only.' };
  const payload = buildPayload(h, actions);
  try {
    const reply = await (useGemini ? callGemini : callClaude)(JSON.stringify(payload));
    const { model } = reply;
    const text = reply.text.trim();
    const lines = text.split('\n').map((l) => l.replace(/^[-*•\d.)\s]+(?=[A-Za-z])/, '').trim()).filter(Boolean).slice(0, 3);
    const check = verifyNumbers(lines.join(' '), payload);
    if (!check.ok) return { ok: false, reason: `Summary rejected: it used numbers not in the plan (${check.bad.join(', ')}).`, rejected: text };
    if (lines.length < 2) return { ok: false, reason: 'Summary came back empty.' };
    return { ok: true, lines, model };
  } catch (e) {
    return { ok: false, reason: `LLM call failed: ${(e as Error).message.slice(0, 160)}` };
  }
}
