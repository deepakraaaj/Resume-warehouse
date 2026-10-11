// One door to every AI model. Each model has its own budget (requests and tokens per minute and per day,
// minimum spacing, cooldowns after a 429). A call goes to the first preferred model with budget left,
// waits briefly when that is cheaper than falling back, and otherwise moves down the list.
import { loadProviders, TASKS, TIMEOUT_MS, SEARCH_LIMITS } from './llm-config.mjs';
import { getStore } from './kv.mjs';

const MIN = 60_000;
const SHORT_WAIT_MS = 3000;
const STATUS_KEY = 'system/llm-status';
const SAVE_EVERY_MS = 30_000;

// ---------- Small helpers ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const utcMonth = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);
const nextUtcMidnight = (t = Date.now()) => { const d = new Date(t); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };
// Google resets daily quotas at midnight Pacific; 08:00 UTC is a safe upper bound.
const nextPacificMidnight = (t = Date.now()) => { const d = new Date(t); d.setUTCHours(8, 0, 0, 0); if (d.getTime() <= t) d.setUTCDate(d.getUTCDate() + 1); return d.getTime(); };

// "1m26.4s", "697ms", "13m20.496s", "2h3m", "37s", "45" (seconds) → milliseconds.
export function parseDuration(text) {
  if (text == null) return null;
  const s = String(text).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000);
  let ms = 0, matched = false;
  for (const [, n, unit] of s.matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g)) {
    matched = true;
    ms += parseFloat(n) * { ms: 1, s: 1000, m: MIN, h: 60 * MIN }[unit];
  }
  return matched ? Math.round(ms) : null;
}

// Pulls a retry time out of an error message or body ("try again in 13m20.496s", "retryDelay": "37s").
export function retryFromText(text) {
  const t = String(text ?? '');
  const m = t.match(/try again in\s+([\d.hms ]+)/i) || t.match(/retryDelay"?\s*[:=]\s*"?([\d.]+s)/i) || t.match(/retry after\s+([\d.]+\s*s)/i);
  return m ? parseDuration(m[1].replace(/\s+/g, '')) : null;
}

export const isDailyLimit = text => /per day|\bTPD\b|\bRPD\b|daily|PerDay|tokens per day|requests per day/i.test(String(text ?? ''));

export function estimateTokens(messages, maxTokens = 0) {
  const chars = (messages ?? []).reduce((n, m) => n + String(m.content ?? '').length, 0);
  return Math.ceil(chars / 4) + maxTokens;
}

// ---------- Budgets ----------

// One budget per model or search provider. Pure bookkeeping; no network.
export class Budget {
  constructor(id, limits, label) {
    this.id = id;
    this.label = label ?? id;
    this.limits = limits ?? {};
    this.minute = []; // [{t, tokens}]
    this.day = { date: utcDay(), requests: 0, tokens: 0 };
    this.month = { month: utcMonth(), requests: 0 };
    this.lastCallAt = 0;
    this.cooldownUntil = 0;
    this.cooldownReason = '';
    this.blocked = null; // {reason, until}
    this.planZero = false; // provider said this plan allows 0 requests; cleared by the next success
    this.header = null;
    this.lastOkAt = 0;
    this.lastError = null;
    this.lastLatencyMs = null;
    this.totals = { requests: 0, tokens: 0, errors: 0 };
  }

  roll(now = Date.now()) {
    this.minute = this.minute.filter(x => now - x.t < MIN);
    if (this.day.date !== utcDay(now)) this.day = { date: utcDay(now), requests: 0, tokens: 0 };
    if (this.month.month !== utcMonth(now)) this.month = { month: utcMonth(now), requests: 0 };
    if (this.blocked && this.blocked.until <= now) this.blocked = null;
  }

  // Milliseconds until this budget can take a call of `tokens`; Infinity when out for the day.
  waitFor(tokens = 0, now = Date.now()) {
    this.roll(now);
    const L = this.limits;
    if (this.blocked) return this.blocked.until - now;
    let wait = Math.max(0, this.cooldownUntil - now);
    if (L.rpd && this.day.requests >= L.rpd) return Math.max(wait, nextUtcMidnight(now) - now);
    if (L.tpd && this.day.tokens + tokens > L.tpd) return Math.max(wait, nextUtcMidnight(now) - now);
    if (L.perMonth && this.month.requests >= L.perMonth) return Infinity;
    // A prompt bigger than the per-minute token cap can never fit this model.
    if (L.tpm && tokens > L.tpm) return Infinity;
    if (this.header?.limitTokens && tokens > this.header.limitTokens) return Infinity;
    if (L.minGapMs) wait = Math.max(wait, this.lastCallAt + L.minGapMs - now);
    if (L.rpm && this.minute.length >= L.rpm) wait = Math.max(wait, this.minute[0].t + MIN - now);
    if (L.tpm) {
      const used = this.minute.reduce((n, x) => n + x.tokens, 0);
      if (used + tokens > L.tpm && this.minute.length) wait = Math.max(wait, this.minute[0].t + MIN - now);
    }
    // Live headers beat our own counting when the provider sends them.
    const h = this.header;
    if (h && now - h.at < MIN) {
      if (h.remainingRequests === 0 && h.resetRequestsAt) wait = Math.max(wait, h.resetRequestsAt - now);
      if (h.remainingTokens != null && h.remainingTokens < tokens && h.resetTokensAt) wait = Math.max(wait, h.resetTokensAt - now);
    }
    return Math.max(0, wait);
  }

  start(now = Date.now()) {
    this.lastCallAt = now;
  }

  record(tokens, latencyMs, now = Date.now()) {
    this.roll(now);
    this.minute.push({ t: now, tokens });
    this.day.requests++;
    this.day.tokens += tokens;
    this.month.requests++;
    this.totals.requests++;
    this.totals.tokens += tokens;
    this.lastOkAt = now;
    this.lastLatencyMs = latencyMs;
    this.planZero = false;
  }

  fail(message, cooldownMs, now = Date.now()) {
    this.totals.errors++;
    this.lastError = { at: now, message: String(message).slice(0, 300) };
    if (cooldownMs) {
      this.cooldownUntil = Math.max(this.cooldownUntil, now + cooldownMs);
      this.cooldownReason = String(message).slice(0, 160);
    }
  }

  block(reason, forMs, now = Date.now()) {
    this.blocked = { reason, until: now + forMs };
    this.lastError = { at: now, message: reason };
  }

  // Reads x-ratelimit-* headers from Groq (per-day requests, per-minute tokens) and Mistral (per-minute, per-month).
  readHeaders(headers, now = Date.now()) {
    const g = name => headers.get(name);
    const num = name => (g(name) == null ? null : Number(g(name)));
    const h = { at: now };
    if (g('x-ratelimit-limit-requests') != null) {
      Object.assign(h, {
        limitRequests: num('x-ratelimit-limit-requests'), remainingRequests: num('x-ratelimit-remaining-requests'),
        limitTokens: num('x-ratelimit-limit-tokens'), remainingTokens: num('x-ratelimit-remaining-tokens'),
        resetRequestsAt: now + (parseDuration(g('x-ratelimit-reset-requests')) ?? 0),
        resetTokensAt: now + (parseDuration(g('x-ratelimit-reset-tokens')) ?? 0),
        window: 'Groq: requests per day, tokens per minute',
      });
    } else if (g('x-ratelimit-limit-req-minute') != null || g('x-ratelimit-limit-tokens-minute') != null) {
      Object.assign(h, {
        limitRequests: num('x-ratelimit-limit-req-minute'), remainingRequests: num('x-ratelimit-remaining-req-minute'),
        limitTokens: num('x-ratelimit-limit-tokens-minute'), remainingTokens: num('x-ratelimit-remaining-tokens-minute'),
        limitTokensMonth: num('x-ratelimit-limit-tokens-month'), remainingTokensMonth: num('x-ratelimit-remaining-tokens-month'),
        resetRequestsAt: now + MIN, resetTokensAt: now + MIN,
        window: 'Mistral: per minute (and month)',
      });
    } else return;
    this.header = h;
    if (h.limitRequests === 0) this.planZero = true;
    if (h.limitRequests === 0) this.block('The provider allows 0 requests on this plan. Turn on its free plan in the provider console.', 10 * MIN, now);
  }

  snapshot(now = Date.now()) {
    this.roll(now);
    const L = this.limits;
    const tokensMin = this.minute.reduce((n, x) => n + x.tokens, 0);
    const wait = this.waitFor(0, now);
    let state = 'ready';
    if (this.blocked || this.planZero) state = 'blocked';
    else if (wait === Infinity || wait > 60 * MIN) state = 'exhausted';
    else if (wait > 0) state = 'cooling';
    return {
      id: this.id, label: this.label, state,
      readyInMs: Number.isFinite(wait) ? wait : null,
      limits: L,
      used: { minuteRequests: this.minute.length, minuteTokens: tokensMin, dayRequests: this.day.requests, dayTokens: this.day.tokens, monthRequests: this.month.requests },
      header: this.header,
      cooldownUntil: this.cooldownUntil > now ? this.cooldownUntil : null,
      cooldownReason: this.cooldownUntil > now ? this.cooldownReason : '',
      blocked: this.blocked ?? (this.planZero ? { reason: 'The provider allows 0 requests on this plan. Turn on its free plan in the provider console, then press Test.', until: now } : null),
      lastOkAt: this.lastOkAt || null,
      lastError: this.lastError,
      lastLatencyMs: this.lastLatencyMs,
      totals: this.totals,
    };
  }

  toJSON() {
    const { id, minute, day, month, lastCallAt, cooldownUntil, cooldownReason, blocked, planZero, header, lastOkAt, lastError, lastLatencyMs, totals } = this;
    return { id, minute, day, month, lastCallAt, cooldownUntil, cooldownReason, blocked, planZero, header, lastOkAt, lastError, lastLatencyMs, totals };
  }

  restore(saved) {
    if (!saved) return;
    for (const k of ['minute', 'day', 'month', 'lastCallAt', 'cooldownUntil', 'cooldownReason', 'blocked', 'planZero', 'header', 'lastOkAt', 'lastError', 'lastLatencyMs', 'totals']) {
      if (saved[k] !== undefined) this[k] = saved[k];
    }
    this.roll();
  }
}

// ---------- Registry ----------

let registry;
let loaded;
let lastSave = 0;
let dirty = false;

function build() {
  const { providers, models } = loadProviders();
  const budgets = new Map();
  for (const m of models) budgets.set(m.id, new Budget(m.id, m.limits, `${m.kind} · ${m.model}`));
  if (providers.groq) {
    const id = 'groq:whisper-large-v3-turbo';
    budgets.set(id, new Budget(id, { rpm: 20, rpd: 2000 }, 'groq · whisper-large-v3-turbo (voice)'));
  }
  if (providers.gemini) budgets.set('search:gemini-grounding', new Budget('search:gemini-grounding', SEARCH_LIMITS['search:gemini-grounding'], 'search · Google via Gemini grounding'));
  if (process.env.TAVILY_API_KEY) budgets.set('search:tavily', new Budget('search:tavily', SEARCH_LIMITS['search:tavily'], 'search · Tavily'));
  return { providers, models, budgets };
}

async function reg() {
  registry ??= build();
  loaded ??= (async () => {
    try {
      const saved = await (await getStore()).get(STATUS_KEY, null);
      for (const s of saved?.budgets ?? []) registry.budgets.get(s.id)?.restore(s);
    } catch { /* first run */ }
  })();
  await loaded;
  return registry;
}

export async function budget(id) {
  return (await reg()).budgets.get(id);
}

// Saves budgets at most every 30 s, or right away after a cooldown or block so other instances see it.
export async function saveStatus(force = false) {
  dirty = true;
  const now = Date.now();
  if (!force && now - lastSave < SAVE_EVERY_MS) return;
  lastSave = now;
  dirty = false;
  try {
    const r = await reg();
    await (await getStore()).put(STATUS_KEY, { savedAt: now, budgets: [...r.budgets.values()].map(b => b.toJSON()) });
  } catch { /* status is best-effort */ }
}

export class AllBusyError extends Error {}

// Picks the model to use now: the first preferred one that's free, or the soonest one if it frees within 3 s.
export async function pick(task, tokens, exclude = new Set()) {
  const r = await reg();
  const order = (TASKS[task] ?? TASKS.smart).filter(id => r.budgets.has(id) && !exclude.has(id));
  if (!order.length) throw new AllBusyError('No AI model is configured. Add LLM_1_URL, LLM_1_MODEL and LLM_1_KEY to the environment.');
  const now = Date.now();
  const waits = order.map(id => ({ id, wait: r.budgets.get(id).waitFor(tokens, now) }));
  const free = waits.find(w => w.wait === 0);
  if (free) return { id: free.id, wait: 0 };
  const soonest = waits.reduce((a, b) => (b.wait < a.wait ? b : a));
  if (soonest.wait <= SHORT_WAIT_MS) return soonest;
  const label = r.budgets.get(soonest.id).label;
  if (!Number.isFinite(soonest.wait)) throw new AllBusyError('This request is too large for the free models that are available right now, or their monthly quota is used up. Try a shorter input, or check Settings → AI limits.');
  throw new AllBusyError(`All free AI models are busy or out of quota right now. ${label} frees up in ${Math.ceil(soonest.wait / 1000)}s. Settings → AI limits shows each model.`);
}

// ---------- Calls ----------

function bodyFor(kind, model, messages, opts) {
  const body = { model, messages, temperature: opts.temperature ?? 0.3, max_tokens: opts.maxTokens ?? 1200 };
  if (opts.json) body.response_format = { type: 'json_object' };
  if (kind === 'groq' && model.startsWith('openai/gpt-oss')) {
    body.reasoning_effort = opts.reasoning ?? 'low';
    body.include_reasoning = false;
  }
  if (kind === 'gemini' && model.startsWith('gemini-2.5')) body.reasoning_effort = opts.reasoning === 'high' ? 'medium' : model.includes('lite') ? 'none' : 'low';
  return body;
}

class CallError extends Error {
  constructor(message, status, retryable) { super(message); this.status = status; this.retryable = retryable; }
}

async function callModel(r, id, messages, opts) {
  const b = r.budgets.get(id);
  const [kind, ...rest] = id.split(':');
  const model = rest.join(':');
  const p = r.providers[kind];
  let body = bodyFor(kind, model, messages, opts);
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    b.start(started);
    let res, text;
    try {
      res = await fetch(`${p.base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
      });
      text = await res.text();
    } catch (err) {
      b.fail(err.name === 'TimeoutError' ? 'Timed out' : `Network error: ${err.message}`, 30_000);
      throw new CallError(`${b.label} did not answer in time.`, 0, true);
    }
    b.readHeaders(res.headers);
    if (res.ok) {
      let data;
      try { data = JSON.parse(text); } catch { data = null; }
      const out = data?.choices?.[0]?.message?.content;
      const tokens = data?.usage?.total_tokens ?? estimateTokens(messages, Math.ceil(String(out ?? '').length / 4));
      b.record(tokens, Date.now() - started);
      if (!out || !String(out).trim()) {
        b.fail('Empty answer', 0);
        throw new CallError(`${b.label} returned an empty answer.`, 200, true);
      }
      return { text: String(out), model: id, tokens, latencyMs: Date.now() - started };
    }
    const msg = (() => { try { const j = JSON.parse(text); return (Array.isArray(j) ? j[0] : j)?.error?.message ?? j?.message ?? text; } catch { return text; } })();
    // Some models reject JSON mode or reasoning params; retry once without them.
    if (res.status === 400 && attempt === 0 && (body.response_format || body.reasoning_effort)) {
      body = { ...body };
      delete body.response_format;
      delete body.reasoning_effort;
      delete body.include_reasoning;
      continue;
    }
    if (res.status === 429) {
      const retry = parseDuration(res.headers.get('retry-after')) ?? retryFromText(msg) ?? retryFromText(text);
      if (b.blocked) throw new CallError(b.blocked.reason, 429, true);
      if (isDailyLimit(msg) || /quota/i.test(msg)) {
        const until = retry ?? ((kind === 'gemini' ? nextPacificMidnight() : nextUtcMidnight()) - Date.now());
        b.fail(`Daily quota used up. ${msg}`, Math.max(until, MIN));
        // Gemini chat and Google-search grounding draw on the same daily quota.
        if (id === 'gemini:gemini-2.5-flash') r.budgets.get('search:gemini-grounding')?.fail(`Daily quota used up (shared with ${id}).`, Math.max(until, MIN));
      } else b.fail(`Rate limited. ${msg}`, Math.max(retry ?? 20_000, 1000));
      throw new CallError(`${b.label} is rate limited.`, 429, true);
    }
    if (res.status === 401 || res.status === 403) {
      b.block(`The key was rejected (${res.status}). Check ${kind.toUpperCase()} key in the environment.`, 30 * MIN);
      throw new CallError(`${b.label}: key rejected.`, res.status, true);
    }
    if (res.status === 404) {
      b.block(`This key cannot use ${model} (404).`, 6 * 60 * MIN);
      throw new CallError(`${b.label}: model not available.`, 404, true);
    }
    b.fail(`HTTP ${res.status}: ${msg}`, res.status >= 500 ? 30_000 : 0);
    throw new CallError(`${b.label} failed: ${String(msg).slice(0, 160)}`, res.status, res.status >= 500);
  }
  throw new CallError(`${b.label} failed.`, 400, false);
}

// chat('fast'|'smart'|'light', messages, {json, maxTokens, temperature, reasoning}) → {text, model, tokens}
export async function chat(task, messages, opts = {}) {
  const r = await reg();
  const tried = new Set(opts.exclude ?? []);
  const est = estimateTokens(messages, opts.maxTokens ?? 1200);
  let lastErr;
  for (let i = 0; i < 6; i++) {
    let choice;
    try { choice = await pick(task, est, tried); }
    catch (err) { if (lastErr && !(err instanceof AllBusyError)) throw lastErr; throw err; }
    if (choice.wait) await sleep(choice.wait);
    try {
      const out = await callModel(r, choice.id, messages, opts);
      saveStatus();
      return out;
    } catch (err) {
      lastErr = err;
      tried.add(choice.id);
      saveStatus(true);
      if (!err.retryable && err.status && err.status !== 429) throw err;
    }
  }
  throw lastErr ?? new AllBusyError('No AI model could answer.');
}

// Finds the JSON object in a model's reply: plain, fenced, or with text around it.
export function parseJson(text) {
  const s = String(text ?? '').trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const candidate of [s, fenced?.[1], s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1), s.slice(s.indexOf('['), s.lastIndexOf(']') + 1)]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* next */ }
  }
  return null;
}

// Like chat, but returns parsed JSON; a malformed answer is retried once on a different model.
export async function chatJson(task, messages, opts = {}) {
  const first = await chat(task, messages, { ...opts, json: true });
  const parsed = parseJson(first.text);
  if (parsed && typeof parsed === 'object') return { data: parsed, model: first.model };
  const second = await chat(task, messages, { ...opts, json: true, exclude: [...(opts.exclude ?? []), first.model] });
  const again = parseJson(second.text);
  if (again && typeof again === 'object') return { data: again, model: second.model };
  throw new Error('The AI answered in a broken format twice. Try again.');
}

// ---------- Voice ----------

export async function transcribe(audio, mime = 'audio/webm') {
  const r = await reg();
  const id = 'groq:whisper-large-v3-turbo';
  const b = r.budgets.get(id);
  if (!b) throw new Error('Voice transcription needs a Groq key. Type your answer instead.');
  const wait = b.waitFor(0);
  if (wait > SHORT_WAIT_MS) throw new Error(`Voice transcription is cooling down for ${Math.ceil(wait / 1000)}s. Type your answer or use the browser's voice input.`);
  if (wait) await sleep(wait);
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime }), `answer.${mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : 'webm'}`);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'en');
  form.append('response_format', 'json');
  const started = Date.now();
  b.start(started);
  const res = await fetch(`${r.providers.groq.base}/audio/transcriptions`, {
    method: 'POST', headers: { Authorization: `Bearer ${r.providers.groq.key}` }, body: form, signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  b.readHeaders(res.headers);
  if (!res.ok) {
    const retry = parseDuration(res.headers.get('retry-after')) ?? retryFromText(text);
    b.fail(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status === 429 ? retry ?? 30_000 : 0);
    saveStatus(true);
    throw new Error(res.status === 429 ? 'Voice transcription hit its limit. Type your answer for now.' : 'Could not transcribe that recording. Try again or type it.');
  }
  b.record(0, Date.now() - started);
  saveStatus();
  return JSON.parse(text).text ?? '';
}

// Interviewer voice: Groq Orpheus when the account has accepted its terms; otherwise the page uses the
// browser's own voice. Returns {audio: base64 wav} or {fallback: reason}.
let ttsBlockedUntil = 0;
export async function speak(text) {
  const t = String(text ?? '').trim().slice(0, 600);
  if (!t) throw new Error('Nothing to say.');
  const r = await reg();
  if (!r.providers.groq || Date.now() < ttsBlockedUntil) return { fallback: 'browser' };
  const id = 'groq:orpheus';
  if (!r.budgets.has(id)) r.budgets.set(id, new Budget(id, { rpm: 10, rpd: 200 }, 'groq · orpheus (interviewer voice)'));
  const b = r.budgets.get(id);
  if (b.waitFor(0) > 0) return { fallback: 'busy' };
  b.start();
  const started = Date.now();
  try {
    const res = await fetch(`${r.providers.groq.base}/audio/speech`, {
      method: 'POST', headers: { Authorization: `Bearer ${r.providers.groq.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'canopylabs/orpheus-v1-english', voice: 'troy', input: t, response_format: 'wav' }),
      signal: AbortSignal.timeout(20_000),
    });
    b.readHeaders(res.headers);
    if (!res.ok) {
      const msg = await res.text();
      if (/terms/i.test(msg)) { ttsBlockedUntil = Date.now() + 30 * MIN; b.block('Accept the Orpheus terms at console.groq.com (Playground, orpheus model) to enable the interviewer voice.', 30 * MIN); }
      else b.fail(`HTTP ${res.status}: ${msg.slice(0, 160)}`, res.status === 429 ? retryFromText(msg) ?? 60_000 : 0);
      saveStatus(true);
      return { fallback: 'browser' };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    b.record(0, Date.now() - started);
    saveStatus();
    return { audio: buf.toString('base64'), mime: 'audio/wav' };
  } catch {
    b.fail('Voice timed out', 30_000);
    return { fallback: 'browser' };
  }
}

// ---------- Settings ----------

export async function status() {
  const r = await reg();
  const now = Date.now();
  const routes = Object.fromEntries(Object.entries(TASKS).map(([task, ids]) => [task, ids.filter(id => r.budgets.has(id))]));
  return {
    now,
    budgets: [...r.budgets.values()].map(b => b.snapshot(now)),
    routes,
    configured: Object.keys(r.providers),
    searchConfigured: { gemini: Boolean(r.providers.gemini), tavily: Boolean(process.env.TAVILY_API_KEY) },
  };
}

// Sends one tiny request to a model so its live limits show up in Settings.
export async function probe(id) {
  const r = await reg();
  if (!r.budgets.has(id) || id.startsWith('search:') || id.includes('whisper')) throw new Error('That model cannot be tested here.');
  const b = r.budgets.get(id);
  if (b.blocked) b.blocked = null;
  b.cooldownUntil = 0;
  try {
    const out = await callModel(r, id, [{ role: 'user', content: 'Reply with the single word OK.' }], { maxTokens: 300, temperature: 0 });
    await saveStatus(true);
    return { ok: true, latencyMs: out.latencyMs, reply: out.text.slice(0, 40) };
  } catch (err) {
    await saveStatus(true);
    return { ok: false, error: err.message };
  }
}

export const _internal = { reg, callModel, reset: () => { registry = undefined; loaded = undefined; } };
